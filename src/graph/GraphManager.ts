import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import Graph from 'graphology';
import Parser from 'web-tree-sitter';

export interface GraphSnapshot {
  nodes: Array<{ id: string; attributes: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; attributes: Record<string, unknown> }>;
}

interface SymbolInfo {
  id: string;
  kind: 'function' | 'class' | 'method' | 'selector';
  name: string;
  startLine: number;
  endLine: number;
  /** Lista de parâmetros (texto literal, ex: "(a: string, b: number)") — grátis, vem do próprio parse. */
  signature?: string;
}

export interface SymbolContextEntry {
  name: string;
  kind: string;
  file: string;
  signature?: string;
}

export interface EnclosingSymbol {
  id: string;
  name: string;
  kind: string;
  signature?: string;
}

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.html', '.htm', '.css'];
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/**
 * Mantém um grafo de arquitetura em memória (arquivos, funções/classes, imports, chamadas).
 * Nunca relê o workspace inteiro para responder — cada save reparseia só o arquivo alterado
 * e o grafo é atualizado incrementalmente (nós antigos do arquivo são descartados e recriados).
 */
export class GraphManager {
  private graph = new Graph({ multi: true, type: 'directed', allowSelfLoops: true });
  private parser: Parser | undefined;
  private tsLanguage: Parser.Language | undefined;
  private tsxLanguage: Parser.Language | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    const wasmDir = path.join(context.extensionPath, 'wasm');

    // O loader WASM do web-tree-sitter, quando um arquivo .wasm não existe/está corrompido,
    // às vezes fica pendurado em vez de rejeitar a Promise — um timeout garante que a
    // ativação da extensão nunca trave esperando isso indefinidamente.
    await this.withTimeout(
      Parser.init({ locateFile: (fileName: string) => path.join(wasmDir, fileName) }),
      'tree-sitter.wasm (runtime)'
    );
    this.parser = new Parser();

    this.tsLanguage = await this.withTimeout(
      Parser.Language.load(path.join(wasmDir, 'tree-sitter-typescript.wasm')),
      'tree-sitter-typescript.wasm'
    );
    this.tsxLanguage = await this.withTimeout(
      Parser.Language.load(path.join(wasmDir, 'tree-sitter-tsx.wasm')),
      'tree-sitter-tsx.wasm'
    );
    this.parser.setLanguage(this.tsLanguage);
  }

  private static readonly MAX_INDEX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — evita travar em bundle/arquivo gerado gigante

  /** Indexação inicial do workspace — roda uma vez em background na ativação. */
  async indexWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,html,htm,css}',
      '**/{node_modules,dist,out,.git}/**',
      2000
    );

    this.output.appendLine(`[GraphManager] indexação inicial: ${files.length} arquivo(s) encontrado(s).`);

    let skipped = 0;
    for (const uri of files) {
      // Defesa extra além do exclude do findFiles — nunca deveria bater, mas se bater, é barato.
      if (/[\\/](node_modules|dist|out|\.git)[\\/]/.test(uri.fsPath)) continue;

      try {
        const stat = await fs.stat(uri.fsPath);
        if (stat.size > GraphManager.MAX_INDEX_FILE_BYTES) {
          skipped += 1;
          continue;
        }
        const text = await fs.readFile(uri.fsPath, 'utf8');
        this.updateFileSync(uri, text);
      } catch (err) {
        this.output.appendLine(`[GraphManager] falha ao indexar ${uri.fsPath}: ${err}`);
      }
    }

    if (skipped > 0) {
      this.output.appendLine(`[GraphManager] ${skipped} arquivo(s) ignorado(s) por serem maiores que 2MB.`);
    }
    this.output.appendLine(
      `[GraphManager] indexação inicial concluída: ${this.graph.order} nós, ${this.graph.size} arestas.`
    );
  }

  /**
   * Parseia um texto sem tocar no grafo — usado pelo `ScanAnimator` pra andar pela árvore real
   * (if/else, blocos) enquanto anima a região sendo analisada. Reaproveita a mesma gramática já
   * carregada, então não tem custo de inicialização.
   */
  parseSnippet(text: string, isJsx: boolean): Parser.Tree | undefined {
    if (!this.parser || !this.tsLanguage || !this.tsxLanguage) return undefined;
    try {
      this.parser.setLanguage(isJsx ? this.tsxLanguage : this.tsLanguage);
      return this.parser.parse(text);
    } catch (err) {
      this.output.appendLine(`[GraphManager] falha ao parsear trecho pro ScanAnimator: ${err}`);
      return undefined;
    }
  }

  async updateFile(uri: vscode.Uri, text: string): Promise<void> {
    if (!SUPPORTED_EXTENSIONS.includes(path.extname(uri.fsPath))) return;
    this.updateFileSync(uri, text);
  }

  removeFile(uri: vscode.Uri): void {
    this.dropFile(this.fileId(uri));
  }

  /**
   * Símbolo (função/método/classe) que envolve uma linha — o "ambiente de coding atual" de
   * verdade, não o arquivo inteiro. Usado pela sugestão inline pra saber exatamente onde o
   * cursor está antes de decidir o que mostrar de contexto.
   */
  getEnclosingSymbol(fileId: string, line: number): EnclosingSymbol | undefined {
    let best: string | undefined;
    let bestSize = Infinity;

    for (const id of this.graph.filterNodes((_n, a) => a.file === fileId && a.kind !== 'file')) {
      const attrs = this.graph.getNodeAttributes(id);
      const start = Number(attrs.startLine ?? -1);
      const end = Number(attrs.endLine ?? -1);
      if (line < start || line > end) continue;
      const size = end - start;
      if (size < bestSize) {
        bestSize = size;
        best = id;
      }
    }

    if (!best) return undefined;
    const attrs = this.graph.getNodeAttributes(best);
    return {
      id: best,
      name: String(attrs.name ?? ''),
      kind: String(attrs.kind ?? ''),
      signature: attrs.signature ? String(attrs.signature) : undefined,
    };
  }

  /**
   * Vizinhança direta de UM símbolo específico (não do arquivo inteiro) — quem ele chama e
   * quem o chama, com assinatura quando disponível. É o que dá pra IA condição de sugerir uma
   * chamada compatível de verdade (nome certo, aridade certa) em vez de inventar.
   */
  getSymbolContext(symbolId: string): SymbolContextEntry[] {
    if (!this.graph.hasNode(symbolId)) return [];

    const neighborIds = new Set<string>([...this.graph.outNeighbors(symbolId), ...this.graph.inNeighbors(symbolId)]);
    const result: SymbolContextEntry[] = [];

    for (const id of neighborIds) {
      if (!this.graph.hasNode(id)) continue;
      const attrs = this.graph.getNodeAttributes(id);
      if (attrs.kind === 'file') continue;
      result.push({
        name: String(attrs.name ?? ''),
        kind: String(attrs.kind ?? ''),
        file: path.basename(String(attrs.file ?? '')),
        signature: attrs.signature ? String(attrs.signature) : undefined,
      });
    }

    return result;
  }

  /**
   * Retorna a vizinhança (nós + arestas) até `depth` saltos a partir do arquivo informado.
   * Isso é o que vai para o Claude — nunca o workspace inteiro.
   */
  getImpactSubgraph(fileId: string, depth = 2): GraphSnapshot {
    if (!this.graph.hasNode(fileId)) {
      return { nodes: [], edges: [] };
    }

    const ownedSymbols = this.graph.filterNodes((_n, attrs) => attrs.file === fileId);
    let frontier = new Set<string>([fileId, ...ownedSymbols]);
    const visited = new Set<string>();

    for (let i = 0; i < depth; i++) {
      const next = new Set<string>();
      for (const node of frontier) {
        if (visited.has(node) || !this.graph.hasNode(node)) continue;
        visited.add(node);
        for (const neighbor of this.graph.neighbors(node)) next.add(neighbor);
      }
      frontier = next;
    }
    for (const node of frontier) {
      if (this.graph.hasNode(node)) visited.add(node);
    }

    const nodes = [...visited].map((id) => ({ id, attributes: this.graph.getNodeAttributes(id) }));
    const edges: GraphSnapshot['edges'] = [];
    const seenEdges = new Set<string>();

    for (const id of visited) {
      for (const edgeId of this.graph.edges(id)) {
        if (seenEdges.has(edgeId)) continue;
        const [source, target] = this.graph.extremities(edgeId);
        if (visited.has(source) && visited.has(target)) {
          seenEdges.add(edgeId);
          edges.push({ source, target, attributes: this.graph.getEdgeAttributes(edgeId) });
        }
      }
    }

    return { nodes, edges };
  }

  /**
   * Retorna a cadeia de um ciclo dirigido passando por `nodeId` (ex: ["login", "refreshToken", "login"]),
   * ou `null` se não houver — sinal de possível loop de feedback entre componentes
   * (ex: serviço A dispara serviço B que dispara A de volta).
   */
  findCycleThrough(nodeId: string): string[] | null {
    if (!this.graph.hasNode(nodeId)) return null;

    const stack: string[] = [nodeId];
    const onStack = new Set<string>([nodeId]);
    // Nós já provados "sem saída de volta pra nodeId" — memoização GLOBAL (não só do caminho
    // atual). Sem isso, um grafo denso faz a busca reexplorar os mesmos ramos exponencialmente
    // (foi o que travou a extensão ao rodar num projeto real, com muito mais arestas que os
    // arquivos de teste isolados).
    const deadEnd = new Set<string>();
    let visitedCount = 0;
    const HARD_LIMIT = 20000; // válvula de segurança — nunca deveria chegar perto disso

    const visit = (current: string): string[] | null => {
      for (const next of this.graph.outNeighbors(current)) {
        if (next === nodeId) return [...stack, next];
        if (onStack.has(next) || deadEnd.has(next)) continue;
        if (++visitedCount > HARD_LIMIT) return null;

        stack.push(next);
        onStack.add(next);
        const found = visit(next);
        if (found) return found;
        onStack.delete(next);
        stack.pop();
        deadEnd.add(next);
      }
      return null;
    };

    return visit(nodeId);
  }

  /** Rótulo legível de um nó — nome do símbolo, ou nome-base do arquivo. */
  getLabel(nodeId: string): string {
    if (!this.graph.hasNode(nodeId)) return nodeId;
    const attrs = this.graph.getNodeAttributes(nodeId);
    if (attrs.kind === 'file') {
      return path.basename(String(attrs.path ?? nodeId));
    }
    return String(attrs.name ?? nodeId);
  }

  /** false se o Tree-sitter não terminou de inicializar (ex: .wasm faltando) — grafo fica vazio até isso ser corrigido. */
  get isReady(): boolean {
    return Boolean(this.parser && this.tsLanguage && this.tsxLanguage);
  }

  get stats(): { nodes: number; edges: number } {
    return { nodes: this.graph.order, edges: this.graph.size };
  }

  dispose(): void {
    this.graph.clear();
  }

  private updateFileSync(uri: vscode.Uri, text: string): void {
    // Tudo aqui dentro é chamado por `updateFile()` a partir de vários `void algumaPromise()`
    // fire-and-forget (debounce de digitação, análise em background, indexação inicial) —
    // nenhum desses call sites tem `.catch()`. Se qualquer etapa daqui (extração, mutação do
    // grafo) lançar uma exceção não prevista, isso vira uma promise rejeitada sem tratamento
    // lá em cima, capaz de derrubar o processo inteiro. Por isso o try/catch cobre tudo.
    try {
      const ext = path.extname(uri.fsPath).toLowerCase();
      if (ext === '.css') {
        this.updateCssFileUnsafe(uri, text);
      } else if (ext === '.html' || ext === '.htm') {
        this.updateHtmlFileUnsafe(uri, text);
      } else if (this.parser && this.tsLanguage && this.tsxLanguage) {
        this.updateCodeFileUnsafe(uri, text);
      }
    } catch (err) {
      this.output.appendLine(`[GraphManager] falha inesperada atualizando o grafo de ${uri.fsPath}: ${err}`);
    }
  }

  private updateCodeFileUnsafe(uri: vscode.Uri, text: string): void {
    const fileId = this.fileId(uri);
    this.dropFile(fileId);

    const isJsx = uri.fsPath.endsWith('.tsx') || uri.fsPath.endsWith('.jsx');
    this.parser!.setLanguage(isJsx ? this.tsxLanguage! : this.tsLanguage!);

    let tree: Parser.Tree;
    try {
      tree = this.parser!.parse(text);
    } catch (err) {
      this.output.appendLine(`[GraphManager] erro de parse em ${uri.fsPath}: ${err}`);
      return;
    }

    if (!this.graph.hasNode(fileId)) {
      this.graph.addNode(fileId, { kind: 'file', path: uri.fsPath });
    }

    const symbols = this.extractSymbols(tree.rootNode, fileId);
    for (const sym of symbols) {
      this.graph.mergeNode(sym.id, {
        kind: sym.kind,
        name: sym.name,
        file: fileId,
        startLine: sym.startLine,
        endLine: sym.endLine,
        signature: sym.signature,
      });
      this.graph.mergeEdgeWithKey(`${fileId}->defines->${sym.id}`, fileId, sym.id, { type: 'defines' });
    }

    const imports = this.extractImports(tree.rootNode, uri);
    for (const target of imports) {
      if (!this.graph.hasNode(target)) {
        this.graph.addNode(target, { kind: 'file', path: target, external: true });
      }
      this.graph.mergeEdgeWithKey(`${fileId}->imports->${target}`, fileId, target, { type: 'imports' });
    }

    // Escopo de resolução de chamada: só o próprio arquivo ou arquivos que ele importa
    // diretamente. Sem isso, um nome comum (get/set/clear — método de Map, por exemplo)
    // casaria com QUALQUER símbolo do workspace inteiro com esse nome, criando arestas
    // falsas entre código sem relação nenhuma (e inflando o grafo até ficar caro/instável).
    const scopeFiles = new Set<string>([fileId, ...imports]);

    const calls = this.extractCalls(tree.rootNode, symbols);
    for (const [callerId, calleeName] of calls) {
      const candidates = this.graph.filterNodes(
        (_n, attrs) => attrs.kind !== 'file' && attrs.name === calleeName && scopeFiles.has(String(attrs.file))
      );
      for (const calleeId of candidates) {
        if (calleeId === callerId) continue;
        this.graph.mergeEdgeWithKey(`${callerId}->calls->${calleeId}`, callerId, calleeId, { type: 'calls' });
      }
    }
  }

  /**
   * CSS: sem gramática Tree-sitter dedicada (pra não depender de mais um .wasm) — extração
   * leve por regex. Seletores viram símbolos "selector" donos deste arquivo, pra cruzar depois
   * com o que um HTML vinculado usa. `@import` vira aresta de import igual ao JS.
   */
  private updateCssFileUnsafe(uri: vscode.Uri, text: string): void {
    const fileId = this.fileId(uri);
    this.dropFile(fileId);
    this.graph.addNode(fileId, { kind: 'file', path: uri.fsPath });

    const selectorRegex = /(^|[\s,{])([.#][a-zA-Z_-][\w-]*)/g;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = selectorRegex.exec(text))) {
      const selector = match[2];
      if (seen.has(selector)) continue;
      seen.add(selector);
      const symId = `${fileId}#${selector}`;
      this.graph.mergeNode(symId, { kind: 'selector', name: selector, file: fileId, startLine: 0, endLine: 0 });
      this.graph.mergeEdgeWithKey(`${fileId}->defines->${symId}`, fileId, symId, { type: 'defines' });
    }

    const importRegex = /@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/g;
    while ((match = importRegex.exec(text))) {
      const target = this.resolveRelativePath(uri, match[1]);
      if (!target) continue;
      if (!this.graph.hasNode(target)) this.graph.addNode(target, { kind: 'file', path: target, external: true });
      this.graph.mergeEdgeWithKey(`${fileId}->imports->${target}`, fileId, target, { type: 'imports' });
    }
  }

  /**
   * HTML: extrai `<link href>`/`<script src>` como imports (mesmo esquema do JS), e guarda os
   * `class=`/`id=` usados (com a linha da primeira ocorrência) como atributo do próprio nó do
   * arquivo — é o que `findUnresolvedHtmlReferences` cruza contra os seletores do CSS vinculado.
   */
  private updateHtmlFileUnsafe(uri: vscode.Uri, text: string): void {
    const fileId = this.fileId(uri);
    this.dropFile(fileId);

    const refRegex = /<(?:link[^>]*\shref|script[^>]*\ssrc)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = refRegex.exec(text))) {
      const target = this.resolveRelativePath(uri, match[1]);
      if (!target) continue;
      if (!this.graph.hasNode(target)) this.graph.addNode(target, { kind: 'file', path: target, external: true });
      this.graph.mergeEdgeWithKey(`${fileId}->imports->${target}`, fileId, target, { type: 'imports' });
    }

    const usageRegex = /\b(class|id)\s*=\s*["']([^"']+)["']/gi;
    const usages: Array<{ token: string; line: number }> = [];
    const seen = new Set<string>();
    let line = 0;
    let cursor = 0;
    while ((match = usageRegex.exec(text))) {
      while (cursor < match.index) {
        if (text.charCodeAt(cursor) === 10) line++;
        cursor++;
      }
      const prefix = match[1].toLowerCase() === 'id' ? '#' : '.';
      for (const token of match[2].split(/\s+/).filter(Boolean)) {
        const key = prefix + token;
        if (seen.has(key)) continue;
        seen.add(key);
        usages.push({ token: key, line });
      }
    }

    this.graph.addNode(fileId, { kind: 'file', path: uri.fsPath, htmlUsages: usages });
  }

  private resolveRelativePath(uri: vscode.Uri, ref: string): string | undefined {
    if (/^([a-z]+:)?\/\//i.test(ref) || ref.startsWith('data:')) return undefined; // URL externa, não é arquivo local
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) return undefined;
    const resolved = path.normalize(path.join(path.dirname(uri.fsPath), clean));
    return vscode.Uri.file(resolved).toString();
  }

  /**
   * Pra arquivos HTML: classes/ids usados que não têm nenhum seletor correspondente em nenhum
   * CSS vinculado (via `<link>`) — o exemplo "html que puxa um css, e uma conexão quebra por
   * causa do CSS" vira, na prática, essa checagem estrutural (grátis, sem IA).
   */
  findUnresolvedHtmlReferences(fileId: string): Array<{ token: string; line: number }> {
    if (!this.graph.hasNode(fileId)) return [];
    const attrs = this.graph.getNodeAttributes(fileId);
    const usages = (attrs.htmlUsages as Array<{ token: string; line: number }> | undefined) ?? [];
    if (usages.length === 0) return [];

    const linkedSelectors = new Set<string>();
    for (const target of this.graph.outNeighbors(fileId)) {
      if (!this.graph.hasNode(target)) continue;
      const selectorNodes = this.graph.filterNodes((_n, a) => a.file === target && a.kind === 'selector');
      for (const symId of selectorNodes) {
        linkedSelectors.add(String(this.graph.getNodeAttributes(symId).name));
      }
    }
    if (linkedSelectors.size === 0) return []; // nenhum CSS vinculado — nada pra cruzar, não é motivo pra alarme

    return usages.filter((u) => !linkedSelectors.has(u.token));
  }

  private dropFile(fileId: string): void {
    if (!this.graph.hasNode(fileId)) return;
    const owned = this.graph.filterNodes((_n, attrs) => attrs.file === fileId);
    for (const n of owned) this.graph.dropNode(n);
    this.graph.dropNode(fileId);
  }

  private fileId(uri: vscode.Uri): string {
    return uri.toString();
  }

  private withTimeout<T>(promise: Promise<T>, label: string, ms = 8000): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout (${ms}ms) carregando ${label} — verifique se o arquivo existe em wasm/ e não está corrompido.`)), ms)
      ),
    ]);
  }

  private extractSymbols(root: Parser.SyntaxNode, fileId: string): SymbolInfo[] {
    const results: SymbolInfo[] = [];

    const visit = (node: Parser.SyntaxNode) => {
      if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode?.text ?? '<anonymous>';
        const kind = node.type === 'class_declaration' ? 'class' : node.type === 'method_definition' ? 'method' : 'function';
        const paramsNode = node.childForFieldName('parameters');
        results.push({
          id: `${fileId}#${name}:${node.startPosition.row}`,
          kind,
          name,
          startLine: node.startPosition.row,
          endLine: node.endPosition.row,
          signature: paramsNode?.text,
        });
      }
      for (const child of node.namedChildren) visit(child);
    };

    visit(root);
    return results;
  }

  private extractImports(root: Parser.SyntaxNode, uri: vscode.Uri): string[] {
    const results: string[] = [];

    const visit = (node: Parser.SyntaxNode) => {
      if (node.type === 'import_statement') {
        const sourceNode = node.namedChildren.find((c) => c.type === 'string');
        const source = sourceNode?.text.replace(/^['"]|['"]$/g, '');
        if (source && source.startsWith('.')) {
          const resolved = path.normalize(path.join(path.dirname(uri.fsPath), source));
          results.push(vscode.Uri.file(resolved).toString());
        }
      }
      for (const child of node.namedChildren) visit(child);
    };

    visit(root);
    return results;
  }

  private extractCalls(root: Parser.SyntaxNode, symbols: SymbolInfo[]): Array<[string, string]> {
    const results: Array<[string, string]> = [];
    const enclosing = (line: number): string | undefined =>
      symbols.find((s) => line >= s.startLine && line <= s.endLine)?.id;

    const visit = (node: Parser.SyntaxNode) => {
      if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        const name =
          fn?.type === 'identifier'
            ? fn.text
            : fn?.type === 'member_expression'
              ? fn.childForFieldName('property')?.text
              : undefined;
        const caller = enclosing(node.startPosition.row);
        if (name && caller) results.push([caller, name]);
      }
      for (const child of node.namedChildren) visit(child);
    };

    visit(root);
    return results;
  }
}
