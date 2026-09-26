import * as path from 'node:path';
import Graph from 'graphology';
import type { Host } from '../host';
import { extOf, toFileId } from '../paths';
import { findCycleThrough } from './cycles';
import { extractCalls, extractImportSpecs, extractSymbols, type RawCall } from './extract-ts';
import { parseCss, parseHtml, resolveWebRef } from './extract-web';
import { TsParser, type SyntaxNode } from './parser';
import { resolveImport } from './resolve-import';
import {
  isSymbolNode,
  type EdgeAttrs,
  type EnclosingSymbol,
  type FileNodeAttrs,
  type GraphSnapshot,
  type HtmlUsage,
  type NodeAttrs,
  type SymbolContextEntry,
  type SymbolCycle,
  type SymbolNodeAttrs,
} from './types';

/** Chamado com a árvore de cada arquivo de código recém-parseado, antes de ela ser liberada. */
export type ParsedListener = (file: { id: string; fsPath: string; root: SyntaxNode }) => void;

export const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm', '.css'];

type G = Graph<NodeAttrs, EdgeAttrs>;

/**
 * Grafo de arquitetura em memória (arquivos, funções/classes, imports, chamadas).
 * Nunca relê o projeto inteiro para responder — cada atualização reparseia só o arquivo
 * alterado e o grafo é atualizado incrementalmente (nós antigos do arquivo são descartados e recriados).
 * Não conhece `vscode`: arquivos são identificados por `toFileId(fsPath)`.
 */
export class CodeGraph {
  private graph: G = new Graph<NodeAttrs, EdgeAttrs>({ multi: true, type: 'directed', allowSelfLoops: true });
  // Chamadas extraídas de cada arquivo, ainda por nome. Ficam guardadas pra poder religar as
  // arestas quando o arquivo chamado for (re)parseado depois — sem isso a ligação dependeria
  // da ordem de indexação, e qualquer edição no arquivo chamado apagaria as arestas de entrada.
  private rawCalls = new Map<string, RawCall[]>();
  // Imports relativos que ainda não resolvem pra nenhum arquivo (ex: o import foi escrito antes
  // de o arquivo ser criado). Revisitados quando um arquivo novo entra no grafo.
  private pendingImports = new Map<string, { fromPath: string; specs: string[] }>();
  private readonly parsedListeners = new Set<ParsedListener>();

  constructor(
    private readonly parser: TsParser | undefined,
    private readonly host: Host
  ) {}

  static async create(wasmDir: string, host: Host): Promise<CodeGraph> {
    return new CodeGraph(await TsParser.load(wasmDir), host);
  }

  /** false se o Tree-sitter não carregou (ex: .wasm faltando) — só HTML/CSS entram no grafo. */
  get isReady(): boolean {
    return this.parser !== undefined;
  }

  /** O mesmo parser do grafo, pra quem precisa de uma árvore avulsa (ex: animação de scan). */
  get tsParser(): TsParser | undefined {
    return this.parser;
  }

  get stats(): { nodes: number; edges: number } {
    return { nodes: this.graph.order, edges: this.graph.size };
  }

  /** Registra quem quer reaproveitar a árvore de cada arquivo (ex: extrator de regras). */
  onParsed(listener: ParsedListener): () => void {
    this.parsedListeners.add(listener);
    return () => this.parsedListeners.delete(listener);
  }

  /**
   * Cópia independente do grafo, sem os listeners — pra simular um conteúdo proposto
   * (verificação de fix) sem que a análise em background leia um estado falso (item 2.3).
   */
  fork(): CodeGraph {
    const copy = new CodeGraph(this.parser, this.host);
    copy.graph = this.graph.copy();
    copy.rawCalls = new Map([...this.rawCalls].map(([k, v]) => [k, v.map((c) => [...c] as RawCall)]));
    copy.pendingImports = new Map(
      [...this.pendingImports].map(([k, v]) => [k, { fromPath: v.fromPath, specs: [...v.specs] }])
    );
    return copy;
  }

  dispose(): void {
    this.graph.clear();
    this.rawCalls.clear();
    this.pendingImports.clear();
    this.parsedListeners.clear();
  }

  static isSupported(fsPath: string): boolean {
    return SUPPORTED_EXTENSIONS.includes(extOf(fsPath));
  }

  /**
   * (Re)indexa um arquivo com o texto dado. Nunca lança: é chamado de vários caminhos
   * fire-and-forget (debounce de digitação, análise em background, indexação inicial) — uma
   * exceção aqui viraria promise rejeitada sem tratamento lá em cima.
   */
  updateFile(fsPath: string, text: string): void {
    if (!CodeGraph.isSupported(fsPath)) return;
    try {
      const ext = extOf(fsPath);
      if (ext === '.css') this.updateCssFile(fsPath, text);
      else if (ext === '.html' || ext === '.htm') this.updateHtmlFile(fsPath, text);
      else if (this.parser) this.updateCodeFile(fsPath, text);
    } catch (err) {
      this.host.log(`[CodeGraph] falha inesperada atualizando o grafo de ${fsPath}: ${err}`);
    }
  }

  /** Arquivo deletado de verdade — remove o nó e tudo ligado a ele (diferente de reparsear). */
  removeFile(fsPath: string): void {
    const fileId = toFileId(fsPath);
    this.clearFileContents(fileId);
    this.rawCalls.delete(fileId);
    this.pendingImports.delete(fileId);
    if (this.graph.hasNode(fileId)) this.graph.dropNode(fileId);
  }

  hasFile(fileId: string): boolean {
    return this.graph.hasNode(fileId);
  }

  /** Símbolos que o arquivo define — via arestas `defines`, sem varrer o grafo inteiro. */
  ownedSymbols(fileId: string): string[] {
    if (!this.graph.hasNode(fileId)) return [];
    return this.graph
      .outEdges(fileId)
      .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'defines')
      .map((e) => this.graph.target(e));
  }

  nodeAttributes(id: string): NodeAttrs | undefined {
    return this.graph.hasNode(id) ? this.graph.getNodeAttributes(id) : undefined;
  }

  hasEdge(source: string, target: string, type: EdgeAttrs['type']): boolean {
    if (!this.graph.hasNode(source) || !this.graph.hasNode(target)) return false;
    return this.graph.edges(source, target).some((e) => this.graph.getEdgeAttribute(e, 'type') === type);
  }

  /**
   * Símbolo (função/método/classe) que envolve uma linha — o "ambiente de coding atual" de
   * verdade, não o arquivo inteiro. Usado pela sugestão inline pra saber exatamente onde o
   * cursor está antes de decidir o que mostrar de contexto.
   */
  getEnclosingSymbol(fileId: string, line: number): EnclosingSymbol | undefined {
    let best: { id: string; attrs: SymbolNodeAttrs } | undefined;
    let bestSize = Infinity;

    for (const id of this.ownedSymbols(fileId)) {
      const attrs = this.graph.getNodeAttributes(id);
      if (!isSymbolNode(attrs)) continue;
      if (line < attrs.startLine || line > attrs.endLine) continue;
      const size = attrs.endLine - attrs.startLine;
      if (size < bestSize) {
        bestSize = size;
        best = { id, attrs };
      }
    }

    if (!best) return undefined;
    return { id: best.id, name: best.attrs.name, kind: best.attrs.kind, signature: best.attrs.signature };
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
      const attrs = this.graph.getNodeAttributes(id);
      if (!isSymbolNode(attrs)) continue;
      result.push({
        name: attrs.name,
        kind: attrs.kind,
        file: path.basename(attrs.file),
        signature: attrs.signature,
      });
    }

    return result;
  }

  /**
   * Retorna a vizinhança (nós + arestas) até `depth` saltos a partir do arquivo informado.
   * Isso é o que vai para a IA — nunca o projeto inteiro.
   */
  getImpactSubgraph(fileId: string, depth = 2): GraphSnapshot {
    if (!this.graph.hasNode(fileId)) return { nodes: [], edges: [] };

    let frontier = new Set<string>([fileId, ...this.ownedSymbols(fileId)]);
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

  findCycleThrough(nodeId: string): string[] | null {
    return findCycleThrough(this.graph, nodeId);
  }

  /**
   * Todos os símbolos do arquivo que participam de um ciclo dirigido. Checagem ÚNICA usada
   * pela análise em background, pela verificação de fix e pela checagem grátis (item 2.2 —
   * antes eram três cópias do mesmo laço).
   */
  cyclesInFile(fileId: string): SymbolCycle[] {
    const result: SymbolCycle[] = [];
    for (const symbolId of this.ownedSymbols(fileId)) {
      const attrs = this.graph.getNodeAttributes(symbolId);
      if (!isSymbolNode(attrs)) continue;
      const cycle = this.findCycleThrough(symbolId);
      if (!cycle) continue;
      result.push({
        symbolId,
        name: attrs.name,
        startLine: attrs.startLine,
        endLine: attrs.endLine,
        path: cycle,
        labels: cycle.map((id) => this.getLabel(id)),
      });
    }
    return result;
  }

  /** Ids de todos os arquivos parseados (sem os placeholders de import ainda não lidos). */
  files(): string[] {
    return this.graph.filterNodes((_id, attrs) => attrs.kind === 'file' && !attrs.external);
  }

  /** Todos os ciclos do grafo, cada um uma única vez (o mesmo ciclo é visto a partir de cada membro). */
  allCycles(): SymbolCycle[] {
    const seen = new Set<string>();
    const result: SymbolCycle[] = [];
    for (const fileId of this.files()) {
      for (const cycle of this.cyclesInFile(fileId)) {
        const key = [...new Set(cycle.path)].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(cycle);
      }
    }
    return result;
  }

  /** Rótulo legível de um nó — nome do símbolo, ou nome-base do arquivo. */
  getLabel(nodeId: string): string {
    if (!this.graph.hasNode(nodeId)) return nodeId;
    const attrs = this.graph.getNodeAttributes(nodeId);
    return isSymbolNode(attrs) ? attrs.name : path.basename(attrs.path);
  }

  /**
   * Pra arquivos HTML: classes/ids usados que não têm nenhum seletor correspondente em nenhum
   * CSS vinculado (via `<link>`) — checagem estrutural, grátis, sem IA.
   */
  findUnresolvedHtmlReferences(fileId: string): HtmlUsage[] {
    const attrs = this.nodeAttributes(fileId);
    if (!attrs || isSymbolNode(attrs)) return [];
    const usages = attrs.htmlUsages ?? [];
    if (usages.length === 0) return [];

    const linkedSelectors = new Set<string>();
    for (const target of this.graph.outNeighbors(fileId)) {
      for (const symId of this.ownedSymbols(target)) {
        const sym = this.graph.getNodeAttributes(symId);
        if (isSymbolNode(sym) && sym.kind === 'selector') linkedSelectors.add(sym.name);
      }
    }
    if (linkedSelectors.size === 0) return []; // nenhum CSS vinculado — nada pra cruzar, não é motivo pra alarme

    return usages.filter((u) => !linkedSelectors.has(u.token));
  }

  // ---------------------------------------------------------------------------------------
  // Atualização por tipo de arquivo

  private updateCodeFile(fsPath: string, text: string): void {
    const fileId = toFileId(fsPath);

    let tree;
    try {
      tree = this.parser!.parse(text, TsParser.isJsxPath(fsPath));
    } catch (err) {
      this.host.log(`[CodeGraph] erro de parse em ${fsPath}: ${err}`);
      return;
    }

    try {
      const root = tree.rootNode;
      this.resetFileNode(fileId, { kind: 'file', path: fsPath });

      const symbols = extractSymbols(root, fileId);
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

      const imports = this.resolveImports(root, fsPath);
      for (const targetPath of imports.resolved) this.addImportEdge(fileId, targetPath);
      if (imports.unresolved.length > 0) {
        this.pendingImports.set(fileId, { fromPath: fsPath, specs: imports.unresolved });
      } else {
        this.pendingImports.delete(fileId);
      }

      this.rawCalls.set(fileId, extractCalls(root, symbols));
      this.relinkCalls(fileId);
      // Os símbolos deste arquivo acabaram de ser recriados (com ids novos se as linhas mudaram) —
      // quem importa este arquivo precisa religar as chamadas que apontavam pra cá.
      this.relinkImporters(fileId);

      for (const listener of this.parsedListeners) {
        try {
          listener({ id: fileId, fsPath, root });
        } catch (err) {
          this.host.log(`[CodeGraph] listener falhou em ${fsPath}: ${err}`);
        }
      }
    } finally {
      tree.delete();
    }
  }

  /** CSS: seletores viram símbolos "selector" deste arquivo; `@import` vira aresta de import. */
  private updateCssFile(fsPath: string, text: string): void {
    const fileId = toFileId(fsPath);
    this.resetFileNode(fileId, { kind: 'file', path: fsPath });

    const { selectors, imports } = parseCss(text);
    for (const selector of selectors) {
      const symId = `${fileId}#${selector}`;
      this.graph.mergeNode(symId, { kind: 'selector', name: selector, file: fileId, startLine: 0, endLine: 0 });
      this.graph.mergeEdgeWithKey(`${fileId}->defines->${symId}`, fileId, symId, { type: 'defines' });
    }
    this.addWebImports(fileId, fsPath, imports);
  }

  /**
   * HTML: `<link>`/`<script>` viram imports; os `class=`/`id=` usados ficam no próprio nó do
   * arquivo — é o que `findUnresolvedHtmlReferences` cruza contra os seletores do CSS vinculado.
   */
  private updateHtmlFile(fsPath: string, text: string): void {
    const fileId = toFileId(fsPath);
    const { usages, refs } = parseHtml(text);
    this.resetFileNode(fileId, { kind: 'file', path: fsPath, htmlUsages: usages });
    this.addWebImports(fileId, fsPath, refs);
  }

  private addWebImports(fileId: string, fsPath: string, refs: string[]): void {
    for (const ref of refs) {
      const target = resolveWebRef(fsPath, ref);
      if (target) this.addImportEdge(fileId, target);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Manutenção incremental do grafo

  /**
   * Prepara o nó do arquivo pra ser reconstruído: remove os símbolos que ele define e as arestas
   * que SAEM dele, mas mantém o nó e as arestas que CHEGAM (imports de outros arquivos). Sem
   * isso, reparsear `style.css` apagava o `<link>` do HTML, e reparsear `b.ts` apagava o import
   * de `a.ts`, até o outro lado ser reparseado de novo.
   */
  private resetFileNode(fileId: string, attributes: FileNodeAttrs): void {
    this.clearFileContents(fileId);
    if (this.graph.hasNode(fileId)) {
      this.graph.replaceNodeAttributes(fileId, attributes);
    } else {
      this.graph.addNode(fileId, attributes);
      this.resolvePendingImportsTo(fileId);
    }
  }

  /** Arquivo novo no grafo: liga os imports que estavam esperando por ele. */
  private resolvePendingImportsTo(newFileId: string): void {
    const isFile = (p: string) => this.host.isFile(p);
    for (const [importerId, pending] of this.pendingImports) {
      const stillPending = pending.specs.filter((spec) => {
        const resolved = resolveImport(pending.fromPath, spec, isFile);
        if (resolved !== undefined && toFileId(resolved) === newFileId) {
          this.addImportEdge(importerId, resolved);
          return false;
        }
        return true;
      });
      if (stillPending.length === 0) this.pendingImports.delete(importerId);
      else pending.specs = stillPending;
    }
  }

  private clearFileContents(fileId: string): void {
    if (!this.graph.hasNode(fileId)) return;
    for (const n of this.ownedSymbols(fileId)) this.graph.dropNode(n);
    for (const e of this.graph.outEdges(fileId)) this.graph.dropEdge(e);
  }

  private addImportEdge(fileId: string, targetFsPath: string): void {
    const target = toFileId(targetFsPath);
    if (!this.graph.hasNode(target)) {
      // Placeholder até o arquivo alvo ser parseado — o `resetFileNode` dele reaproveita este nó.
      this.graph.addNode(target, { kind: 'file', path: targetFsPath, external: true });
    }
    this.graph.mergeEdgeWithKey(`${fileId}->imports->${target}`, fileId, target, { type: 'imports' });
  }

  /**
   * (Re)cria as arestas `calls` de um arquivo a partir das chamadas guardadas por nome.
   * Escopo de resolução: só o próprio arquivo e os que ele importa diretamente — sem isso um
   * nome comum (get/set/clear) casaria com qualquer símbolo homônimo do projeto inteiro.
   */
  private relinkCalls(fileId: string): void {
    const calls = this.rawCalls.get(fileId);
    if (!calls || calls.length === 0 || !this.graph.hasNode(fileId)) return;

    const byName = new Map<string, string[]>();
    for (const scopeFile of [fileId, ...this.importTargets(fileId)]) {
      for (const symId of this.ownedSymbols(scopeFile)) {
        const attrs = this.graph.getNodeAttributes(symId);
        if (!isSymbolNode(attrs)) continue;
        const list = byName.get(attrs.name);
        if (list) list.push(symId);
        else byName.set(attrs.name, [symId]);
      }
    }

    for (const [callerId, calleeName] of calls) {
      if (!this.graph.hasNode(callerId)) continue;
      for (const calleeId of byName.get(calleeName) ?? []) {
        if (calleeId === callerId) continue;
        this.graph.mergeEdgeWithKey(`${callerId}->calls->${calleeId}`, callerId, calleeId, { type: 'calls' });
      }
    }
  }

  private relinkImporters(fileId: string): void {
    for (const edge of this.graph.inEdges(fileId)) {
      if (this.graph.getEdgeAttribute(edge, 'type') !== 'imports') continue;
      const importer = this.graph.source(edge);
      if (importer !== fileId) this.relinkCalls(importer);
    }
  }

  private importTargets(fileId: string): string[] {
    return this.graph
      .outEdges(fileId)
      .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'imports')
      .map((e) => this.graph.target(e));
  }

  /**
   * Imports relativos do arquivo: `resolved` são caminhos em disco; `unresolved` são os
   * especificadores que ainda não apontam pra nenhum arquivo existente.
   */
  private resolveImports(root: SyntaxNode, fsPath: string): { resolved: string[]; unresolved: string[] } {
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const spec of extractImportSpecs(root)) {
      const target = resolveImport(fsPath, spec, (p) => this.host.isFile(p));
      if (target) resolved.push(target);
      else unresolved.push(spec);
    }
    return { resolved, unresolved };
  }
}
