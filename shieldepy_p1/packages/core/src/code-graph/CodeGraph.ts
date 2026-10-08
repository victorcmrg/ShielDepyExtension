import * as path from 'node:path';
import Graph from 'graphology';
import type { Host } from '../host';
import { extOf, toFileId } from '../paths';
import { findCycleThrough } from './cycles';
import { extractModuleInfo, type ImportBinding, type ModuleInfo } from './extract-module';
import { extractCalls, extractSymbols, type CallDesc, type RawArg, type RawCall, type Scope, type TypeRef } from './extract-ts';
import { parseCss, parseHtml, resolveWebRef } from './extract-web';
import { GrammarParser, TsParser } from './parser';
import { ModuleResolver } from './resolve-import';
import {
  isSymbolNode,
  packageNodeId,
  type CallArg,
  type CallCoverage,
  type CallOutcome as PublicCallOutcome,
  type CallSite,
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
  type ValueOrigin,
} from './types';

/** Chamado com a árvore de cada arquivo de código recém-parseado, antes de ela ser liberada. */
export type ParsedListener = (file: { id: string; fsPath: string; root: import('./parser').SyntaxNode }) => void;

export const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.htm', '.css'];

type G = Graph<NodeAttrs, EdgeAttrs>;

export interface WebParsers {
  html?: GrammarParser;
  css?: GrammarParser;
}

/** Para onde um especificador de import de um arquivo aponta (já resolvido). */
type SpecTarget = { kind: 'file'; id: string } | { kind: 'package'; name: string } | { kind: 'unresolved' };

type FileCoverage = Omit<CallCoverage, 'importsUnresolved'>;
type CallOutcome = keyof FileCoverage | 'unbound';

interface CallResolution {
  outcome: CallOutcome;
  targets: string[];
  /** Em `callsExternal`: o pacote (o nó dele pode nem existir, ex: import só de tipo removido). */
  package?: string;
}

const PUBLIC_OUTCOME: Record<CallOutcome, PublicCallOutcome> = {
  callsResolved: 'resolved',
  callsHeuristic: 'heuristic',
  callsUnresolved: 'unresolved',
  callsExternal: 'external',
  unbound: 'unbound',
};

const UNRESOLVED: CallResolution = { outcome: 'callsUnresolved', targets: [] };
/** Receptor de tipo conhecido mas fora do projeto e sem pacote (`Map`, `URL`, `X[]`, interface sem classe): não se adivinha. */
const NATIVE: CallResolution = { outcome: 'unbound', targets: [] };

/** Classes que um nome de tipo representa, ou o pacote de onde o tipo vem. */
interface ResolvedType {
  classes: string[];
  external?: string;
}

/** Caches de uma passada de religação (valem só enquanto o grafo não muda). */
interface ResolutionContext {
  bindings(fileId: string): Map<string, ImportBinding>;
  legacy(name: string): string[];
  implementers(iface: string): string[];
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
  // Quem resolveu algum tipo por `implements` (interface → classes). Esses arquivos não importam a
  // classe que implementa, então a religação por import não os alcança: religam por aqui.
  private interfaceDependents = new Map<string, Set<string>>();
  private readonly parsedListeners = new Set<ParsedListener>();
  private readonly resolver: ModuleResolver;

  constructor(
    private readonly parser: TsParser | undefined,
    private readonly host: Host,
    /** Gramáticas de HTML/CSS. Sem uma delas, arquivos daquele tipo ficam fora do grafo. */
    private readonly web: WebParsers = {}
  ) {
    this.resolver = new ModuleResolver(host);
  }

  static async create(wasmDir: string, host: Host): Promise<CodeGraph> {
    const optional = (name: 'html' | 'css') =>
      GrammarParser.load(wasmDir, name).catch((err) => {
        host.log(`[CodeGraph] gramática ${name} indisponível — arquivos .${name} ficam fora do grafo: ${err}`);
        return undefined;
      });
    const [ts, html, css] = await Promise.all([TsParser.load(wasmDir), optional('html'), optional('css')]);
    return new CodeGraph(ts, host, { html, css });
  }

  /** false se a gramática de TS não carregou (ex: .wasm faltando) — o grafo fica sem código TS/JS. */
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

  /** Esquece os tsconfig/jsconfig lidos (sem religar nada) — ver `reloadModuleConfig`. */
  invalidateConfig(): void {
    this.resolver.invalidate();
  }

  /**
   * Um tsconfig/jsconfig mudou (ex: `paths` novo): relê a configuração e refaz, em TODOS os
   * arquivos de código, a resolução dos imports e as arestas de chamada — sem reparsear nada
   * (a tabela de módulo de cada arquivo continua válida; só o destino dos especificadores muda).
   */
  reloadModuleConfig(): void {
    this.resolver.invalidate();
    const touchedPackages = new Set<string>();
    for (const [fileId, info] of this.moduleInfo) {
      if (!this.graph.hasNode(fileId)) continue;
      const attrs = this.graph.getNodeAttributes(fileId);
      if (attrs.kind !== 'file') continue;
      for (const e of this.graph.outEdges(fileId)) {
        if (this.graph.getEdgeAttribute(e, 'type') !== 'imports') continue;
        const target = this.graph.target(e);
        if (this.isPackage(target)) touchedPackages.add(target);
        this.graph.dropEdge(e);
      }
      this.linkImports(fileId, attrs.path, info.specs);
    }
    this.dropOrphanPackages(touchedPackages);
    for (const fileId of this.moduleInfo.keys()) this.relinkCalls(fileId);
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
    const copy = new CodeGraph(this.parser, this.host, this.web);
    copy.graph = this.graph.copy();
    copy.rawCalls = new Map([...this.rawCalls].map(([k, v]) => [k, v.map((c) => ({ ...c }))]));
    copy.moduleInfo = new Map(this.moduleInfo);
    copy.specTargets = new Map([...this.specTargets].map(([k, v]) => [k, new Map(v)]));
    copy.coverage = new Map(this.coverage);
    copy.interfaceDependents = new Map([...this.interfaceDependents].map(([k, v]) => [k, new Set(v)]));
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
    this.interfaceDependents.clear();
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
      if (ext === '.css') {
        if (this.web.css) this.updateCssFile(fsPath, text, this.web.css);
      } else if (ext === '.html' || ext === '.htm') {
        if (this.web.html) this.updateHtmlFile(fsPath, text, this.web.html);
      }
      else if (this.parser) this.updateCodeFile(fsPath, text);
    } catch (err) {
      this.host.log(`[CodeGraph] falha inesperada atualizando o grafo de ${fsPath}: ${err}`);
    }
  }

  /** Arquivo deletado de verdade — remove o nó e tudo ligado a ele (diferente de reparsear). */
  removeFile(fsPath: string): void {
    const fileId = toFileId(fsPath);
    const implemented = this.implementedNames(fileId);
    this.clearFileContents(fileId);
    this.rawCalls.delete(fileId);
    this.pendingImports.delete(fileId);
    this.moduleInfo.delete(fileId);
    this.specTargets.delete(fileId);
    this.coverage.delete(fileId);
    if (this.graph.hasNode(fileId)) this.graph.dropNode(fileId);
    this.relinkInterfaceDependents(implemented, fileId);
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

  /** O grafo inteiro (nós + arestas), pra exportar — `buildSystemGraph` é quem deixa isso estável e portátil. */
  toSnapshot(): GraphSnapshot {
    return {
      nodes: this.graph.mapNodes((id, attributes) => ({ id, attributes })),
      edges: this.graph.mapEdges((_e, attributes, source, target) => ({ source, target, attributes })),
    };
  }

  /**
   * Cada chamada do arquivo, resolvida, em ordem de execução aproximada (pela posição em que a
   * chamada termina: em `a(b())` o `b` vem antes). Inclui as do topo do arquivo, com o arquivo
   * como chamador. É o que a topologia percorre: as arestas juntam várias chamadas num `caller→target` só.
   */
  callSitesIn(fileId: string): CallSite[] {
    const calls = this.rawCalls.get(fileId);
    if (!calls) return [];
    const ctx = this.resolutionContext(fileId);
    return calls
      .filter((c) => c.kind !== 'ref' && c.line !== undefined)
      .sort((a, b) => a.end! - b.end!)
      .map((c) => this.toCallSite(fileId, c, ctx));
  }

  /** As chamadas feitas dentro de um símbolo (não as dos callbacks que ele contém), em ordem de execução aproximada. */
  callsOf(symbolId: string): CallSite[] {
    const attrs = this.nodeAttributes(symbolId);
    if (!attrs || !isSymbolNode(attrs)) return [];
    return this.callSitesIn(attrs.file).filter((c) => c.caller === symbolId);
  }

  findCycleThrough(nodeId: string): string[] | null {
    // Só `calls`: passar uma função como valor (`references`) não é um laço de execução.
    return findCycleThrough(
      {
        hasNode: (id) => this.graph.hasNode(id),
        outNeighbors: (id) =>
          this.graph.outEdges(id).filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'calls').map((e) => this.graph.target(e)),
      },
      nodeId
    );
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
      const implementedBefore = this.implementedNames(fileId);
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
          ...(sym.container !== undefined && { container: sym.container }),
          ...(sym.extends !== undefined && { extends: sym.extends }),
          ...(sym.implements !== undefined && { implements: sym.implements }),
          ...(sym.fields !== undefined && { fields: sym.fields }),
          ...(sym.properties !== undefined && { properties: sym.properties }),
          ...(sym.returns !== undefined && { returns: sym.returns }),
        });
        this.graph.mergeEdgeWithKey(`${fileId}->defines->${sym.id}`, fileId, sym.id, { type: 'defines' });
      }

      const info = extractModuleInfo(root);
      this.moduleInfo.set(fileId, info);
      this.linkImports(fileId, fsPath, info.specs);

      this.rawCalls.set(fileId, extractCalls(root, symbols, fileId));
      this.relinkCalls(fileId);
      // Os símbolos deste arquivo acabaram de ser recriados (com ids novos se as linhas mudaram) —
      // quem importa este arquivo (direto ou via barrel) precisa religar as chamadas que apontavam pra cá.
      this.relinkImporters(fileId);
      // ...e quem chega aqui por uma interface (`repo: IRepo` → `class PgRepo implements IRepo`) também.
      this.relinkInterfaceDependents(new Set([...implementedBefore, ...this.implementedNames(fileId)]), fileId);

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
  private updateCssFile(fsPath: string, text: string, css: GrammarParser): void {
    const fileId = toFileId(fsPath);
    this.resetFileNode(fileId, { kind: 'file', path: fsPath });

    const { selectors, imports } = css.withTree(text, parseCss);
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
  private updateHtmlFile(fsPath: string, text: string, html: GrammarParser): void {
    const fileId = toFileId(fsPath);
    const { usages, refs } = html.withTree(text, parseHtml);
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
   * (Re)cria as arestas `calls`/`references` de um arquivo a partir das chamadas guardadas.
   * Ordem de resolução de uma chamada:
   *   1. tipo do receptor (`this`, `super`, campo tipado, variável `new X()`, parâmetro tipado),
   *      com herança e `implements`;
   *   2. ligação de import (alias, default, namespace, barrel, require, instância exportada);
   *   3. símbolo/objeto do próprio arquivo;
   *   4. fallback por nome no arquivo + imports (aresta marcada `heuristic`).
   */
  private relinkCalls(fileId: string): void {
    const calls = this.rawCalls.get(fileId);
    if (!calls || !this.graph.hasNode(fileId)) return;

    // Arestas antigas saem antes: a resolução pode ter mudado sem este arquivo mudar (ex: barrel editado).
    const touchedPackages = new Set<string>();
    for (const source of [fileId, ...this.ownedSymbols(fileId)]) {
      for (const e of this.graph.outEdges(source)) {
        const type = this.graph.getEdgeAttribute(e, 'type');
        if (type !== 'calls' && type !== 'references') continue;
        const target = this.graph.target(e);
        if (this.isPackage(target)) touchedPackages.add(target);
        this.graph.dropEdge(e);
      }
    }

    const ctx = this.resolutionContext(fileId);
    const coverage = { ...EMPTY_COVERAGE };
    const edges = new Map<string, { source: string; target: string; type: 'calls' | 'references'; heuristic: boolean }>();
    for (const call of calls) {
      if (!this.graph.hasNode(call.caller)) continue;
      const isRef = call.kind === 'ref';
      // chamada no topo do arquivo (`router.post(...)`, `new Svc()`) só serve a `callSitesIn`: não é aresta de símbolo nem conta na cobertura
      if (!isRef && call.caller === fileId) continue;
      const { outcome, targets } = call.symbolId
        ? { outcome: 'callsResolved' as const, targets: this.graph.hasNode(call.symbolId) ? [call.symbolId] : [] }
        : this.resolveCall(fileId, call, ctx);
      if (!isRef && outcome !== 'unbound') coverage[outcome] += 1;
      // referência só entra com prova: `res.json(order)` não pode virar aresta pra uma função `order`
      if (isRef && outcome !== 'callsResolved') continue;
      const type = isRef ? 'references' : 'calls';
      const heuristic = outcome === 'callsHeuristic';
      for (const target of targets) {
        if (target === call.caller) continue;
        // referência é a uma FUNÇÃO (handler, callback); passar um valor/classe não executa nada
        if (isRef && !this.isCallable(target)) continue;
        const key = `${call.caller}->${type}->${target}`;
        const prev = edges.get(key);
        // ligação provada vence a heurística quando as duas apontam pro mesmo alvo
        if (!prev || (prev.heuristic && !heuristic)) edges.set(key, { source: call.caller, target, type, heuristic });
      }
    }
    for (const [key, e] of edges) {
      this.graph.mergeEdgeWithKey(key, e.source, e.target, e.heuristic ? { type: e.type, heuristic: true } : { type: e.type });
    }
    this.dropOrphanPackages(touchedPackages);
    this.coverage.set(fileId, coverage);
  }

  private resolutionContext(fileId: string): ResolutionContext {
    const bindingCache = new Map<string, Map<string, ImportBinding>>();
    let legacyScope: Map<string, string[]> | undefined;
    let implementers: Map<string, string[]> | undefined;
    return {
      bindings: (file) => {
        let map = bindingCache.get(file);
        if (!map) {
          map = new Map((this.moduleInfo.get(file)?.imports ?? []).map((b) => [b.local, b]));
          bindingCache.set(file, map);
        }
        return map;
      },
      legacy: (name) => {
        legacyScope ??= this.symbolsByName([fileId, ...this.importTargets(fileId).flatMap((t) => this.exportClosure(t))]);
        return legacyScope.get(name) ?? [];
      },
      implementers: (iface) => {
        let dependents = this.interfaceDependents.get(iface);
        if (!dependents) this.interfaceDependents.set(iface, (dependents = new Set()));
        dependents.add(fileId);
        if (!implementers) {
          implementers = new Map();
          this.graph.forEachNode((id, attrs) => {
            if (attrs.kind !== 'class') return;
            for (const name of attrs.implements ?? []) {
              const list = implementers!.get(name);
              if (list) list.push(id);
              else implementers!.set(name, [id]);
            }
          });
        }
        return implementers.get(iface) ?? [];
      },
    };
  }

  private resolveCall(fileId: string, call: CallDesc, ctx: ResolutionContext, depth = 0): CallResolution {
    // `f()` com `f` variável local (parâmetro, callback) não é nenhum símbolo do projeto;
    // `obj.m()` com `obj` local sem tipo ainda pode cair no fallback por nome.
    if (call.shadowed) return call.object && !call.opaque ? this.guess(call, ctx) : NATIVE;

    if (call.dynamic) return this.guess(call, ctx);

    if (call.receiver) {
      const byType =
        'call' in call.receiver
          ? this.resolveReturnMember(fileId, call.receiver.call, call.receiver.rest, call.name, ctx, depth)
          : this.resolveMember(fileId, call.receiver.type, call.receiver.rest, call.name, ctx);
      if (byType) return byType;
    }

    const [root, ...rest] = call.object ?? [];
    if (root === 'this' || root === 'super') return this.guess(call, ctx);
    const binding = ctx.bindings(fileId).get(root ?? call.name);

    if (binding) {
      const target = this.specTargets.get(fileId)?.get(binding.spec);
      if (!target || target.kind === 'unresolved') return UNRESOLVED;
      if (target.kind === 'package') return this.external(target.name);

      if (!call.object) {
        // `b()` com `import { a as b }` / `import b from` / `const b = require()`
        return this.found(this.resolveExport(target.id, binding.imported === '*' ? 'default' : binding.imported));
      }
      if (binding.imported === '*') {
        // `ns.fn()` com `import * as ns` / `const ns = require()`; `ns.obj.m()` segue a instância exportada
        if (rest.length === 0) return this.found(this.resolveExport(target.id, call.name));
        return this.resolveMemberOfExport(target.id, rest[0]!, rest.slice(1), call.name, ctx);
      }
      // `orderService.create()` com `import { orderService }` — instância, objeto ou classe (estático)
      return this.resolveMemberOfExport(target.id, binding.imported, rest, call.name, ctx);
    }

    if (!call.object) {
      const local = this.topLevelByName(fileId, call.name);
      if (local.length > 0) return { outcome: 'callsResolved', targets: local };
    } else {
      const member = this.resolveMemberOfLocal(fileId, root!, rest, call.name, ctx);
      if (member) return member;
      // Receptor não declarado no arquivo nem importado (variáveis locais chegam aqui como `shadowed`):
      // é global do runtime (`console`, `JSON`, `process`) — não é código do projeto.
      if (!this.declaresTopLevel(fileId, root!)) return NATIVE;
    }
    return this.guess(call, ctx);
  }

  private toCallSite(fileId: string, call: RawCall, ctx: ResolutionContext): CallSite {
    const r = this.resolveCall(fileId, call, ctx);
    const origin = call.object ? this.valueOrigin(fileId, call.object, call.scope, ctx) : undefined;
    return {
      caller: call.caller,
      line: call.line!,
      column: call.column!,
      name: call.name,
      ...(call.object && { object: call.object }),
      ...this.publicResolution(r),
      ...(call.shadowed && { shadowed: true }),
      ...(origin && { receiverOrigin: origin }),
      args: (call.args ?? []).map((a) => this.resolveArg(fileId, a, ctx)),
    };
  }

  private publicResolution(r: CallResolution): { outcome: PublicCallOutcome; targets: string[]; package?: string } {
    return {
      outcome: PUBLIC_OUTCOME[r.outcome],
      targets: r.outcome === 'callsExternal' ? [] : r.targets,
      ...(r.package !== undefined && { package: r.package }),
    };
  }

  private resolveArg(fileId: string, arg: RawArg, ctx: ResolutionContext): CallArg {
    if (arg.kind !== 'name') return arg;
    const origin = this.valueOrigin(fileId, arg.chain, arg.scope, ctx);
    return {
      kind: 'name',
      chain: arg.chain,
      ...this.publicResolution(this.resolveCall(fileId, arg.ref, ctx)),
      ...(origin && { origin }),
    };
  }

  /**
   * Onde a raiz de `chain` é declarada: no próprio chamador (`local`), no topo deste arquivo, ou
   * — se veio de um import — no arquivo que a declara, atravessando barrels. `this`, globais e
   * pacotes ficam sem origem.
   */
  private valueOrigin(fileId: string, chain: string[], scope: Scope | undefined, ctx: ResolutionContext): ValueOrigin | undefined {
    const [root, next] = chain;
    if (!root || root === 'this' || root === 'super') return undefined;
    if (scope === 'local') return { file: fileId, name: root, local: true };
    if (scope === 'module') return { file: fileId, name: root };
    const binding = ctx.bindings(fileId).get(root);
    if (!binding) return this.declaresTopLevel(fileId, root) ? { file: fileId, name: root } : undefined;
    const target = this.specTargets.get(fileId)?.get(binding.spec);
    if (target?.kind !== 'file') return undefined;
    // `import * as routes` + `routes.orders` → o export `orders`; sem membro, o namespace não é um valor declarado
    const exported = binding.imported === '*' ? next : binding.imported;
    const loc = exported ? this.resolveExportLocal(target.id, exported, new Set()) : undefined;
    return loc && { file: loc.file, name: loc.local };
  }

  /**
   * `m` no valor devolvido por outra chamada: `new X().m()`, `repo().save()` com `repo(): Repo`,
   * `Router().post()` (pacote → externa), `JSON.parse(x).m()` (nativo).
   */
  private resolveReturnMember(
    fileId: string,
    inner: CallDesc,
    rest: string[],
    method: string,
    ctx: ResolutionContext,
    depth: number
  ): CallResolution | undefined {
    if (depth > 8) return undefined;
    const produced = this.resolveCall(fileId, inner, ctx, depth + 1);
    if (produced.outcome === 'callsExternal') return produced;
    if (produced.outcome === 'unbound') return NATIVE;
    if (produced.outcome !== 'callsResolved') return undefined;

    const classes = new Set<string>();
    let external: string | undefined;
    let declared = false;
    for (const id of produced.targets) {
      const attrs = this.graph.hasNode(id) ? this.graph.getNodeAttributes(id) : undefined;
      if (!attrs || !isSymbolNode(attrs)) continue;
      if (attrs.kind === 'class') {
        classes.add(id);
        continue;
      }
      if (!attrs.returns) continue;
      declared = true;
      if (attrs.returns.length === 0) continue;
      const t = this.resolveType(attrs.file, attrs.returns, ctx);
      for (const c of t.classes) classes.add(c);
      external ??= t.external;
    }
    if (classes.size > 0) return this.membersOf([...classes], rest, method, ctx);
    if (external) return this.external(external);
    // retorno anotado com tipo de fora do projeto → nativo; sem anotação → fallback por nome
    return declared ? NATIVE : undefined;
  }

  /** Fallback por nome (comportamento antigo): o arquivo + o que ele importa. */
  private guess(call: CallDesc, ctx: ResolutionContext): CallResolution {
    const guessed = ctx.legacy(call.name);
    return guessed.length > 0 ? { outcome: 'callsHeuristic', targets: guessed } : { outcome: 'unbound', targets: [] };
  }

  private found(ids: string[]): CallResolution {
    return ids.length > 0 ? { outcome: 'callsResolved', targets: ids } : UNRESOLVED;
  }

  private external(pkgName: string): CallResolution {
    const pkg = packageNodeId(pkgName);
    return { outcome: 'callsExternal', targets: this.graph.hasNode(pkg) ? [pkg] : [], package: pkgName };
  }

  /**
   * `m` num valor do tipo `type`, depois de atravessar os campos `rest`
   * (`this.deps.repo.save()`). `undefined` = o tipo não é do projeto nem de pacote conhecido
   * (ex: `Map`, `Error`) — quem chamou tenta outro caminho.
   */
  private resolveMember(fileId: string, type: TypeRef, rest: string[], method: string, ctx: ResolutionContext): CallResolution | undefined {
    const resolved = this.resolveType(fileId, type, ctx);
    if (resolved.external) return this.external(resolved.external);
    if (resolved.classes.length === 0) return NATIVE;
    return this.membersOf(resolved.classes, rest, method, ctx);
  }

  private membersOf(classes: string[], rest: string[], method: string, ctx: ResolutionContext): CallResolution | undefined {
    let current = classes;
    for (const field of rest) {
      const next = new Set<string>();
      let external: string | undefined;
      let typed = false;
      for (const cls of current) {
        const t = this.fieldType(cls, field, ctx, new Set());
        typed ||= t !== undefined;
        for (const c of t?.classes ?? []) next.add(c);
        external ??= t?.external;
      }
      // campo com tipo declarado fora do projeto → nativo; campo sem tipo → quem chamou tenta o fallback
      if (next.size === 0) return external ? this.external(external) : typed ? NATIVE : undefined;
      current = [...next];
    }

    const ids = new Set<string>();
    let external: string | undefined;
    let unknownBase = false;
    for (const cls of current) {
      const m = this.methodsOf(cls, method, ctx, new Set());
      for (const id of m.ids) ids.add(id);
      external ??= m.external;
      unknownBase ||= m.unknownBase;
    }
    if (ids.size > 0) return { outcome: 'callsResolved', targets: [...ids] };
    if (external) return this.external(external);
    // método herdado de uma base fora do projeto (`extends Error`) ou função guardada num campo — não é falha do mapa
    return unknownBase ? NATIVE : UNRESOLVED;
  }

  /** Métodos `name` da classe, subindo pela cadeia de `extends`. */
  private methodsOf(
    classId: string,
    name: string,
    ctx: ResolutionContext,
    seen: Set<string>
  ): { ids: string[]; external?: string; unknownBase: boolean } {
    const attrs = this.graph.hasNode(classId) ? this.graph.getNodeAttributes(classId) : undefined;
    if (!attrs || !isSymbolNode(attrs) || seen.has(classId)) return { ids: [], unknownBase: false };
    seen.add(classId);
    const ids = this.ownedSymbols(attrs.file).filter((id) => {
      const m = this.graph.getNodeAttributes(id);
      return isSymbolNode(m) && m.kind === 'method' && m.container === attrs.name && m.name === name;
    });
    if (ids.length > 0) return { ids, unknownBase: false };
    // `this.log()` com `log` propriedade (função guardada num campo): é valor, não método do projeto
    if (attrs.properties?.includes(name)) return { ids: [], unknownBase: true };
    if (!attrs.extends) return { ids, unknownBase: false };
    const base = this.resolveType(attrs.file, attrs.extends, ctx);
    if (base.external) return { ids: [], external: base.external, unknownBase: false };
    if (base.classes.length === 0) return { ids: [], unknownBase: true };
    const merged = { ids: [] as string[], external: undefined as string | undefined, unknownBase: false };
    for (const b of base.classes) {
      const r = this.methodsOf(b, name, ctx, seen);
      merged.ids.push(...r.ids);
      merged.external ??= r.external;
      merged.unknownBase ||= r.unknownBase;
    }
    return merged;
  }

  /** Tipo do campo `field` da classe (ou de uma base). `undefined` = campo sem tipo conhecido. */
  private fieldType(classId: string, field: string, ctx: ResolutionContext, seen: Set<string>): ResolvedType | undefined {
    const attrs = this.graph.hasNode(classId) ? this.graph.getNodeAttributes(classId) : undefined;
    if (!attrs || !isSymbolNode(attrs) || seen.has(classId)) return undefined;
    seen.add(classId);
    const declared = attrs.fields?.[field];
    if (declared) return this.resolveType(attrs.file, declared, ctx);
    if (!attrs.extends) return undefined;
    for (const base of this.resolveType(attrs.file, attrs.extends, ctx).classes) {
      const t = this.fieldType(base, field, ctx, seen);
      if (t) return t;
    }
    return undefined;
  }

  /**
   * Classe(s) que um nome de tipo representa no arquivo: import (inclusive `ns.Tipo`), classe
   * local, ou — se for uma interface — as classes que a implementam.
   */
  private resolveType(fileId: string, type: TypeRef, ctx: ResolutionContext): ResolvedType {
    const [head, ...tail] = type;
    if (!head) return { classes: [] };
    const binding = ctx.bindings(fileId).get(head);
    if (binding) {
      const target = this.specTargets.get(fileId)?.get(binding.spec);
      if (target?.kind === 'package') return { classes: [], external: target.name };
      if (target?.kind !== 'file') return { classes: [] };
      const exported = binding.imported === '*' ? tail[0] : binding.imported;
      if (!exported) return { classes: [] };
      const classes = this.resolveExport(target.id, exported).filter((id) => this.graph.getNodeAttribute(id, 'kind') === 'class');
      return { classes: classes.length > 0 ? classes : ctx.implementers(exported) };
    }
    if (tail.length > 0) return { classes: [] };
    const local = this.topLevelByName(fileId, head).filter((id) => this.graph.getNodeAttribute(id, 'kind') === 'class');
    return { classes: local.length > 0 ? local : ctx.implementers(head) };
  }

  /**
   * `local.m()` onde `local` é um nome do topo de `fileId`: classe (método estático), objeto
   * literal (`const repo = { save() {} }`) ou instância (`const svc = new Svc()`).
   */
  private resolveMemberOfLocal(
    fileId: string,
    local: string,
    rest: string[],
    method: string,
    ctx: ResolutionContext,
    depth = 0
  ): CallResolution | undefined {
    const classes = this.topLevelByName(fileId, local).filter((id) => this.graph.getNodeAttribute(id, 'kind') === 'class');
    if (classes.length > 0) return this.membersOf(classes, rest, method, ctx);
    // objeto literal, inclusive aninhado: `config.invariants.check()` → método de contêiner `config.invariants`
    const container = [local, ...rest].join('.');
    const members = this.ownedSymbols(fileId).filter((id) => {
      const m = this.graph.getNodeAttributes(id);
      return isSymbolNode(m) && m.container === container && m.name === method;
    });
    if (members.length > 0) return { outcome: 'callsResolved', targets: members };
    // propriedade que aponta para um nome (`export default { createApp }`): segue o nome, no arquivo do objeto
    const alias = this.moduleInfo.get(fileId)?.objectRefs.get(`${container}.${method}`);
    if (alias && depth < 8) return this.resolveCall(fileId, { name: alias }, ctx, depth + 1);
    const type = this.moduleInfo.get(fileId)?.valueTypes.get(local);
    return type ? this.resolveMember(fileId, type, rest, method, ctx) : undefined;
  }

  /** `x.m()` com `x` importado de `fileId` (seguindo barrels até onde `x` é declarado). */
  private resolveMemberOfExport(fileId: string, exported: string, rest: string[], method: string, ctx: ResolutionContext): CallResolution {
    const loc = this.resolveExportLocal(fileId, exported, new Set());
    if (!loc) return UNRESOLVED;
    const member = this.resolveMemberOfLocal(loc.file, loc.local, rest, method, ctx);
    if (member) return member;
    // Valor de tipo nativo (`new Set()`, array, string): `.has()`/`.map()` não são código do projeto.
    if (this.moduleInfo.get(loc.file)?.valueTypes.has(loc.local)) return { outcome: 'unbound', targets: [] };
    // Valor sem tipo conhecido: o método está, no mínimo, no módulo de onde ele veio — se existir lá.
    const scope = this.symbolsByName(this.exportClosure(fileId)).get(method) ?? [];
    return scope.length > 0 ? { outcome: 'callsHeuristic', targets: scope } : { outcome: 'unbound', targets: [] };
  }

  /** Símbolo(s) que `fileId` exporta com o nome `exported`. */
  private resolveExport(fileId: string, exported: string): string[] {
    const loc = this.resolveExportLocal(fileId, exported, new Set());
    return loc ? this.topLevelByName(loc.file, loc.local) : [];
  }

  /**
   * Onde um export é DECLARADO: arquivo + nome local, seguindo re-exports, barrels
   * (`export * from`) e `export { x }` de algo importado. `seen` evita laço entre barrels.
   */
  private resolveExportLocal(fileId: string, exported: string, seen: Set<string>): { file: string; local: string } | undefined {
    const key = `${fileId}|${exported}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    const info = this.moduleInfo.get(fileId);
    if (!info) return undefined;
    const targetOf = (spec: string) => {
      const t = this.specTargets.get(fileId)?.get(spec);
      return t?.kind === 'file' ? t.id : undefined;
    };

    const local = info.exports.get(exported);
    if (local !== undefined) {
      if (this.topLevelByName(fileId, local).length > 0 || info.valueTypes.has(local) || this.hasContainer(fileId, local)) {
        return { file: fileId, local };
      }
      const binding = info.imports.find((b) => b.local === local);
      const from = binding && targetOf(binding.spec);
      if (binding && from) return this.resolveExportLocal(from, binding.imported === '*' ? 'default' : binding.imported, seen);
      return { file: fileId, local };
    }
    for (const re of info.reexports) {
      if (re.exported !== exported || re.imported === '*') continue;
      const from = targetOf(re.spec);
      if (from) return this.resolveExportLocal(from, re.imported, seen);
    }
    if (exported !== 'default') {
      for (const re of info.reexports) {
        if (re.exported !== '*') continue;
        const from = targetOf(re.spec);
        const loc = from ? this.resolveExportLocal(from, exported, seen) : undefined;
        if (loc) return loc;
      }
    }
    // Script/CommonJS sem export declarado: o que está no topo do arquivo é o que existe.
    if (info.exports.size === 0 && info.reexports.length === 0) return { file: fileId, local: exported };
    return undefined;
  }

  private isCallable(nodeId: string): boolean {
    const kind = this.graph.getNodeAttribute(nodeId, 'kind');
    return kind === 'function' || kind === 'method';
  }

  /** Nomes de interface que as classes do arquivo declaram em `implements`. */
  private implementedNames(fileId: string): Set<string> {
    const names = new Set<string>();
    for (const id of this.ownedSymbols(fileId)) {
      const attrs = this.graph.getNodeAttributes(id);
      if (attrs.kind === 'class') for (const n of attrs.implements ?? []) names.add(n);
    }
    return names;
  }

  private relinkInterfaceDependents(interfaces: Set<string>, changedFile: string): void {
    const files = new Set<string>();
    for (const name of interfaces) for (const f of this.interfaceDependents.get(name) ?? []) files.add(f);
    for (const f of files) if (f !== changedFile && this.graph.hasNode(f)) this.relinkCalls(f);
  }

  private declaresTopLevel(fileId: string, name: string): boolean {
    return this.topLevelByName(fileId, name).length > 0 || this.hasContainer(fileId, name) || !!this.moduleInfo.get(fileId)?.valueTypes.has(name);
  }

  private hasContainer(fileId: string, name: string): boolean {
    return this.ownedSymbols(fileId).some((id) => {
      const attrs = this.graph.getNodeAttributes(id);
      return isSymbolNode(attrs) && attrs.container !== undefined && (attrs.container === name || attrs.container.startsWith(`${name}.`));
    });
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
