import * as path from 'node:path';
import Graph from 'graphology';
import type { Host } from '../host';
import { extOf, toFileId } from '../paths';
import { findCycleThrough } from './cycles';
import { extractModuleInfo, type ImportBinding, type ModuleInfo } from './extract-module';
import { extractCalls, extractSymbols, type RawCall } from './extract-ts';
import { parseCss, parseHtml, resolveWebRef } from './extract-web';
import { TsParser } from './parser';
import { ModuleResolver } from './resolve-import';
import {
  isSymbolNode,
  packageNodeId,
  type CallCoverage,
  type EdgeAttrs,
  type EnclosingSymbol,
  type FileNodeAttrs,
  type GraphSnapshot,
  type GraphStats,
  type HtmlUsage,
  type NodeAttrs,
  type SymbolContextEntry,
  type SymbolCycle,
  type SymbolNodeAttrs,
} from './types';

/** Chamado com a árvore de cada arquivo de código recém-parseado, antes de ela ser liberada. */
export type ParsedListener = (file: { id: string; fsPath: string; root: import('./parser').SyntaxNode }) => void;

export const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm', '.css'];

type G = Graph<NodeAttrs, EdgeAttrs>;

/** Para onde um especificador de import de um arquivo aponta (já resolvido). */
type SpecTarget = { kind: 'file'; id: string } | { kind: 'package'; name: string } | { kind: 'unresolved' };

type FileCoverage = Omit<CallCoverage, 'importsUnresolved'>;
type CallOutcome = keyof FileCoverage | 'unbound';

interface CallResolution {
  outcome: CallOutcome;
  targets: string[];
}

const EMPTY_COVERAGE: FileCoverage = { callsResolved: 0, callsHeuristic: 0, callsUnresolved: 0, callsExternal: 0 };

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
  // Tabela de imports/exports de cada arquivo de código e o destino de cada especificador.
  private moduleInfo = new Map<string, ModuleInfo>();
  private specTargets = new Map<string, Map<string, SpecTarget>>();
  private coverage = new Map<string, FileCoverage>();
  private readonly parsedListeners = new Set<ParsedListener>();
  private readonly resolver: ModuleResolver;

  constructor(
    private readonly parser: TsParser | undefined,
    private readonly host: Host
  ) {
    this.resolver = new ModuleResolver(host);
  }

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

  get stats(): GraphStats {
    const totals = { ...EMPTY_COVERAGE };
    for (const c of this.coverage.values()) {
      totals.callsResolved += c.callsResolved;
      totals.callsHeuristic += c.callsHeuristic;
      totals.callsUnresolved += c.callsUnresolved;
      totals.callsExternal += c.callsExternal;
    }
    let importsUnresolved = 0;
    for (const p of this.pendingImports.values()) importsUnresolved += p.specs.length;
    return { nodes: this.graph.order, edges: this.graph.size, ...totals, importsUnresolved };
  }

  /** Cobertura de chamadas de UM arquivo (pra apontar onde o mapa está fraco). */
  fileCoverage(fileId: string): FileCoverage & { importsUnresolved: string[] } {
    return { ...(this.coverage.get(fileId) ?? EMPTY_COVERAGE), importsUnresolved: [...(this.pendingImports.get(fileId)?.specs ?? [])] };
  }

  /** Tabela de imports/exports do arquivo (como o parse a viu). */
  moduleInfoOf(fileId: string): ModuleInfo | undefined {
    return this.moduleInfo.get(fileId);
  }

  /** Esquece os tsconfig/jsconfig lidos — chamar quando um deles mudar. */
  invalidateConfig(): void {
    this.resolver.invalidate();
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
    copy.rawCalls = new Map([...this.rawCalls].map(([k, v]) => [k, v.map((c) => ({ ...c }))]));
    copy.moduleInfo = new Map(this.moduleInfo);
    copy.specTargets = new Map([...this.specTargets].map(([k, v]) => [k, new Map(v)]));
    copy.coverage = new Map(this.coverage);
    copy.pendingImports = new Map(
      [...this.pendingImports].map(([k, v]) => [k, { fromPath: v.fromPath, specs: [...v.specs] }])
    );
    return copy;
  }

  dispose(): void {
    this.graph.clear();
    this.rawCalls.clear();
    this.pendingImports.clear();
    this.moduleInfo.clear();
    this.specTargets.clear();
    this.coverage.clear();
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
    this.moduleInfo.delete(fileId);
    this.specTargets.delete(fileId);
    this.coverage.delete(fileId);
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
    if (attrs.kind === 'package') return attrs.name;
    return isSymbolNode(attrs) ? attrs.name : path.basename(attrs.path);
  }

  /**
   * Pra arquivos HTML: classes/ids usados que não têm nenhum seletor correspondente em nenhum
   * CSS vinculado (via `<link>`) — checagem estrutural, grátis, sem IA.
   */
  findUnresolvedHtmlReferences(fileId: string): HtmlUsage[] {
    const attrs = this.nodeAttributes(fileId);
    if (attrs?.kind !== 'file') return [];
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

      const info = extractModuleInfo(root);
      this.moduleInfo.set(fileId, info);
      this.linkImports(fileId, fsPath, info.specs);

      this.rawCalls.set(fileId, extractCalls(root, symbols));
      this.relinkCalls(fileId);
      // Os símbolos deste arquivo acabaram de ser recriados (com ids novos se as linhas mudaram) —
      // quem importa este arquivo (direto ou via barrel) precisa religar as chamadas que apontavam pra cá.
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
    for (const [importerId, pending] of this.pendingImports) {
      const stillPending = pending.specs.filter((spec) => {
        const target = this.resolver.resolve(pending.fromPath, spec);
        if (target.kind === 'file' && toFileId(target.path) === newFileId) {
          this.addImportEdge(importerId, target.path);
          this.specTargets.get(importerId)?.set(spec, { kind: 'file', id: newFileId });
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
    const touchedPackages = new Set<string>();
    for (const n of this.ownedSymbols(fileId)) {
      for (const t of this.graph.outNeighbors(n)) if (this.isPackage(t)) touchedPackages.add(t);
      this.graph.dropNode(n);
    }
    for (const e of this.graph.outEdges(fileId)) {
      const t = this.graph.target(e);
      if (this.isPackage(t)) touchedPackages.add(t);
      this.graph.dropEdge(e);
    }
    this.dropOrphanPackages(touchedPackages);
  }

  private isPackage(nodeId: string): boolean {
    return this.graph.getNodeAttribute(nodeId, 'kind') === 'package';
  }

  /** Pacote que ninguém mais importa nem chama sai do grafo. */
  private dropOrphanPackages(ids: Iterable<string>): void {
    for (const p of ids) if (this.graph.hasNode(p) && this.graph.inDegree(p) === 0) this.graph.dropNode(p);
  }

  /** Liga cada especificador do arquivo: arquivo do projeto, pacote externo ou pendente. */
  private linkImports(fileId: string, fsPath: string, specs: string[]): void {
    const targets = new Map<string, SpecTarget>();
    const unresolved: string[] = [];
    for (const spec of specs) {
      const target = this.resolver.resolve(fsPath, spec);
      if (target.kind === 'file') {
        this.addImportEdge(fileId, target.path);
        targets.set(spec, { kind: 'file', id: toFileId(target.path) });
      } else if (target.kind === 'package') {
        const pkg = packageNodeId(target.name);
        this.graph.mergeNode(pkg, { kind: 'package', name: target.name });
        this.graph.mergeEdgeWithKey(`${fileId}->imports->${pkg}`, fileId, pkg, { type: 'imports' });
        targets.set(spec, target);
      } else {
        unresolved.push(spec);
        targets.set(spec, target);
      }
    }
    this.specTargets.set(fileId, targets);
    if (unresolved.length > 0) this.pendingImports.set(fileId, { fromPath: fsPath, specs: unresolved });
    else this.pendingImports.delete(fileId);
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
   * Ordem de resolução: ligação de import (com alias, default, namespace, barrel, require) →
   * símbolo do próprio arquivo → fallback por nome no arquivo + imports (marcado `heuristic`).
   */
  private relinkCalls(fileId: string): void {
    const calls = this.rawCalls.get(fileId);
    if (!calls || !this.graph.hasNode(fileId)) return;

    // Arestas antigas saem antes: a resolução pode ter mudado sem este arquivo mudar (ex: barrel editado).
    const touchedPackages = new Set<string>();
    for (const symId of this.ownedSymbols(fileId)) {
      for (const e of this.graph.outEdges(symId)) {
        if (this.graph.getEdgeAttribute(e, 'type') !== 'calls') continue;
        const target = this.graph.target(e);
        if (this.isPackage(target)) touchedPackages.add(target);
        this.graph.dropEdge(e);
      }
    }

    const bindings = new Map<string, ImportBinding>();
    for (const b of this.moduleInfo.get(fileId)?.imports ?? []) bindings.set(b.local, b);
    let legacyScope: Map<string, string[]> | undefined;
    const legacy = (name: string) => {
      legacyScope ??= this.symbolsByName([fileId, ...this.importTargets(fileId).flatMap((t) => this.exportClosure(t))]);
      return legacyScope.get(name) ?? [];
    };

    const coverage = { ...EMPTY_COVERAGE };
    const edges = new Map<string, { source: string; target: string; heuristic: boolean }>();
    for (const call of calls) {
      if (!this.graph.hasNode(call.caller)) continue;
      const { outcome, targets } = this.resolveCall(fileId, call, bindings, legacy);
      if (outcome !== 'unbound') coverage[outcome] += 1;
      const heuristic = outcome === 'callsHeuristic';
      for (const target of targets) {
        if (target === call.caller) continue;
        const key = `${call.caller}->calls->${target}`;
        const prev = edges.get(key);
        // ligação provada vence a heurística quando as duas apontam pro mesmo alvo
        if (!prev || (prev.heuristic && !heuristic)) edges.set(key, { source: call.caller, target, heuristic });
      }
    }
    for (const [key, e] of edges) {
      this.graph.mergeEdgeWithKey(key, e.source, e.target, e.heuristic ? { type: 'calls', heuristic: true } : { type: 'calls' });
    }
    this.dropOrphanPackages(touchedPackages);
    this.coverage.set(fileId, coverage);
  }

  private resolveCall(
    fileId: string,
    call: RawCall,
    bindings: Map<string, ImportBinding>,
    legacy: (name: string) => string[]
  ): CallResolution {
    const [root, ...rest] = call.object ?? [];
    const binding = bindings.get(root ?? call.name);

    if (binding) {
      const target = this.specTargets.get(fileId)?.get(binding.spec);
      if (!target || target.kind === 'unresolved') return { outcome: 'callsUnresolved', targets: [] };
      if (target.kind === 'package') {
        const pkg = packageNodeId(target.name);
        return { outcome: 'callsExternal', targets: this.graph.hasNode(pkg) ? [pkg] : [] };
      }

      let ids: string[];
      if (!call.object) {
        // `b()` com `import { a as b }` / `import b from` / `const b = require()`
        ids = this.resolveExport(target.id, binding.imported === '*' ? 'default' : binding.imported);
      } else if (binding.imported === '*' && rest.length === 0) {
        // `ns.fn()` com `import * as ns` / `const ns = require()`
        ids = this.resolveExport(target.id, call.name);
      } else {
        // `service.create()` com `import { service }` — o método está no módulo de onde veio a ligação
        const scope = this.symbolsByName(this.exportClosure(target.id));
        const named = scope.get(call.name) ?? [];
        const methods = named.filter((id) => this.graph.getNodeAttribute(id, 'kind') === 'method');
        ids = methods.length > 0 ? methods : named;
      }
      return ids.length > 0 ? { outcome: 'callsResolved', targets: ids } : { outcome: 'callsUnresolved', targets: [] };
    }

    if (!call.object) {
      const local = this.topLevelByName(fileId, call.name);
      if (local.length > 0) return { outcome: 'callsResolved', targets: local };
    }

    const guessed = legacy(call.name);
    return guessed.length > 0 ? { outcome: 'callsHeuristic', targets: guessed } : { outcome: 'unbound', targets: [] };
  }

  /**
   * Símbolo(s) que `fileId` exporta com o nome `exported`, seguindo re-exports, barrels
   * (`export * from`) e `export { x }` de algo importado. `seen` evita laço entre barrels.
   */
  private resolveExport(fileId: string, exported: string, seen = new Set<string>()): string[] {
    const key = `${fileId}|${exported}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const info = this.moduleInfo.get(fileId);
    if (!info) return [];
    const targetOf = (spec: string) => {
      const t = this.specTargets.get(fileId)?.get(spec);
      return t?.kind === 'file' ? t.id : undefined;
    };

    const local = info.exports.get(exported);
    if (local !== undefined) {
      const ids = this.topLevelByName(fileId, local);
      if (ids.length > 0) return ids;
      const binding = info.imports.find((b) => b.local === local);
      const from = binding && targetOf(binding.spec);
      if (binding && from) return this.resolveExport(from, binding.imported === '*' ? 'default' : binding.imported, seen);
      return [];
    }
    for (const re of info.reexports) {
      if (re.exported !== exported || re.imported === '*') continue;
      const from = targetOf(re.spec);
      if (from) return this.resolveExport(from, re.imported, seen);
    }
    if (exported !== 'default') {
      for (const re of info.reexports) {
        if (re.exported !== '*') continue;
        const from = targetOf(re.spec);
        const ids = from ? this.resolveExport(from, exported, seen) : [];
        if (ids.length > 0) return ids;
      }
    }
    // Script/CommonJS sem export declarado: o que está no topo do arquivo é o que existe.
    if (info.exports.size === 0 && info.reexports.length === 0) return this.topLevelByName(fileId, exported);
    return [];
  }

  /** O arquivo e todos os que ele re-exporta (barrels), sem repetição. */
  private exportClosure(fileId: string): string[] {
    const out = new Set<string>();
    const stack = [fileId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (out.has(id)) continue;
      out.add(id);
      for (const re of this.moduleInfo.get(id)?.reexports ?? []) {
        const t = this.specTargets.get(id)?.get(re.spec);
        if (t?.kind === 'file') stack.push(t.id);
      }
    }
    return [...out];
  }

  /** Símbolos do arquivo com esse nome — funções/classes primeiro; métodos só se não houver outro. */
  private topLevelByName(fileId: string, name: string): string[] {
    const all = this.ownedSymbols(fileId).filter((id) => {
      const attrs = this.graph.getNodeAttributes(id);
      return isSymbolNode(attrs) && attrs.name === name;
    });
    const top = all.filter((id) => this.graph.getNodeAttribute(id, 'kind') !== 'method');
    return top.length > 0 ? top : all;
  }

  private symbolsByName(fileIds: string[]): Map<string, string[]> {
    const byName = new Map<string, string[]>();
    for (const scopeFile of fileIds) {
      for (const symId of this.ownedSymbols(scopeFile)) {
        const attrs = this.graph.getNodeAttributes(symId);
        if (!isSymbolNode(attrs)) continue;
        const list = byName.get(attrs.name);
        if (list) list.push(symId);
        else byName.set(attrs.name, [symId]);
      }
    }
    return byName;
  }

  /**
   * Religa quem importa `fileId`. Se o importador for um barrel (re-exporta), quem importa o
   * barrel também precisa ser religado — a cadeia `a → index → svc` quebra se só `index` for.
   */
  private relinkImporters(fileId: string, seen = new Set<string>([fileId])): void {
    for (const edge of this.graph.inEdges(fileId)) {
      if (this.graph.getEdgeAttribute(edge, 'type') !== 'imports') continue;
      const importer = this.graph.source(edge);
      if (seen.has(importer)) continue;
      seen.add(importer);
      this.relinkCalls(importer);
      if (this.forwardsImports(importer)) this.relinkImporters(importer, seen);
    }
  }

  /** O arquivo repassa algo que importou (`export * from`, `export { x } from`, `export { importado }`)? */
  private forwardsImports(fileId: string): boolean {
    const info = this.moduleInfo.get(fileId);
    if (!info) return false;
    if (info.reexports.length > 0) return true;
    const imported = new Set(info.imports.map((b) => b.local));
    return [...info.exports.values()].some((local) => imported.has(local));
  }

  private importTargets(fileId: string): string[] {
    return this.graph
      .outEdges(fileId)
      .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'imports')
      .map((e) => this.graph.target(e))
      .filter((t) => !this.isPackage(t));
  }
}
