import * as path from 'node:path';
import Graph from 'graphology';
import type { Host } from '../host';
import { extOf, toFileId } from '../paths';
import { findCycleThrough } from './cycles';
import type { ImportBinding, ModuleInfo } from './extract-module';
import { looksGenerated } from './generated';
import type { CallDesc, RawArg, RawCall, Scope, TypeRef } from './extract-ts';
import { csharpFrontend, tsFrontend, type LanguageFrontend, type LanguageId, type NamespaceScope } from './frontend';
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
  type ReceiverCall,
  type SymbolContextEntry,
  type SymbolCycle,
  type SymbolNodeAttrs,
  type ValueOrigin,
} from './types';

/** Chamado com a árvore de cada arquivo de código recém-parseado, antes de ela ser liberada. */
export type ParsedListener = (file: { id: string; fsPath: string; language: LanguageId; root: import('./parser').SyntaxNode }) => void;

export const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.cs', '.html', '.htm', '.css'];

type G = Graph<NodeAttrs, EdgeAttrs>;

export interface WebParsers {
  html?: GrammarParser;
  css?: GrammarParser;
}

/** Gramáticas das linguagens além de TS/JS (etapa L). Sem uma delas, os arquivos dela ficam fora do mapa. */
export interface LanguageParsers {
  csharp?: GrammarParser;
}

/** Para onde um especificador de import de um arquivo aponta (já resolvido). */
type SpecTarget = { kind: 'file'; id: string } | { kind: 'package'; name: string } | { kind: 'unresolved' };

/** Um modelo do Mongoose: onde ele é criado (`mongoose.model('User', userSchema)`) e se o valor é um documento dele. */
interface ModelRef {
  file: string;
  produced: CallDesc;
  document: boolean;
}

/** Tabela de módulo + os valores do topo que saem de uma chamada (`const app = express()`). */
type FileModule = ModuleInfo & { valueCalls: Map<string, CallDesc> };

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
  /** C#/Java: as classes do projeto com esse nome simples, em qualquer namespace (registra a dependência). */
  typesNamed(name: string): string[];
  /** C#/Java: os `global using` de todos os arquivos. */
  globalUsings(): string[];
  /** C#: os métodos de extensão do projeto com esse nome (registra a dependência). */
  extensionsNamed(name: string): string[];
  /** C#: as classes que tratam (MediatR) uma mensagem com esse nome simples (registra a dependência). */
  handlersOf(name: string): string[];
}

/** Chave dos métodos de extensão no `typeDependents` (o nome do método, não de uma classe). */
const EXTENSION_KEY = 'ext:';
/** Chave das mensagens do MediatR no `typeDependents` (quem despachou `Command` religa quando um handler dela muda). */
const MESSAGE_KEY = 'msg:';

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
  private moduleInfo = new Map<string, FileModule>();
  private specTargets = new Map<string, Map<string, SpecTarget>>();
  private coverage = new Map<string, FileCoverage>();
  // Quem resolveu algum tipo por `implements` (interface → classes). Esses arquivos não importam a
  // classe que implementa, então a religação por import não os alcança: religam por aqui.
  private interfaceDependents = new Map<string, Set<string>>();
  // C#/Java: o que cada arquivo enxerga (namespaces/packages) e quem resolveu um nome de tipo pelo
  // índice de classes. Não há import de arquivo para religar: quem dependeu de `OrderService` religa
  // quando uma classe com esse nome entra, sai ou muda — sem isso o mapa dependeria da ordem.
  private scopes = new Map<string, NamespaceScope>();
  private typeDependents = new Map<string, Set<string>>();
  private readonly parsedListeners = new Set<ParsedListener>();
  private readonly resolver: ModuleResolver;
  /** Uma linguagem por extensão (TS/JS hoje); HTML e CSS têm caminho próprio (`web`). */
  private readonly frontends: LanguageFrontend[];
  // Valores (`arquivo|nome`) sendo resolvidos pelo retorno da chamada que os produz — corta o laço.
  private readonly valueCallStack = new Set<string>();

  constructor(
    private readonly parser: TsParser | undefined,
    private readonly host: Host,
    /** Gramáticas de HTML/CSS. Sem uma delas, arquivos daquele tipo ficam fora do grafo. */
    private readonly web: WebParsers = {},
    private readonly languages: LanguageParsers = {}
  ) {
    this.resolver = new ModuleResolver(host);
    this.frontends = parser ? [tsFrontend(parser)] : [];
    if (languages.csharp) this.frontends.push(csharpFrontend(languages.csharp));
  }

  static async create(wasmDir: string, host: Host): Promise<CodeGraph> {
    const optional = (name: 'html' | 'css' | 'c_sharp') =>
      GrammarParser.load(wasmDir, name).catch((err) => {
        host.log(`[CodeGraph] gramática ${name} indisponível — os arquivos dela ficam fora do grafo: ${err}`);
        return undefined;
      });
    const [ts, html, css, csharp] = await Promise.all([TsParser.load(wasmDir), optional('html'), optional('css'), optional('c_sharp')]);
    return new CodeGraph(ts, host, { html, css }, { csharp });
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
      // C#/Java: os especificadores são pacotes, não dependem de tsconfig
      if (!this.graph.hasNode(fileId) || this.scopes.has(fileId)) continue;
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
    const copy = new CodeGraph(this.parser, this.host, this.web, this.languages);
    copy.graph = this.graph.copy();
    copy.rawCalls = new Map([...this.rawCalls].map(([k, v]) => [k, v.map((c) => ({ ...c }))]));
    copy.moduleInfo = new Map(this.moduleInfo);
    copy.specTargets = new Map([...this.specTargets].map(([k, v]) => [k, new Map(v)]));
    copy.coverage = new Map(this.coverage);
    copy.interfaceDependents = new Map([...this.interfaceDependents].map(([k, v]) => [k, new Set(v)]));
    copy.scopes = new Map(this.scopes);
    copy.typeDependents = new Map([...this.typeDependents].map(([k, v]) => [k, new Set(v)]));
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
    this.scopes.clear();
    this.typeDependents.clear();
    this.parsedListeners.clear();
  }

  /** O grafo parseia este arquivo de código (há frontend e a gramática dele carregou)? HTML/CSS não contam. */
  parsesCode(fsPath: string): boolean {
    const ext = extOf(fsPath);
    return this.frontends.some((f) => f.extensions.includes(ext));
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
    // Minificado ou saída de bundler: fora do mapa (e sai, se já estava — o build pode ter sobrescrito).
    if (looksGenerated(fsPath, text)) {
      const fileId = toFileId(fsPath);
      if (!this.graph.hasNode(fileId)) return;
      // Importado por alguém (`import './index.css'`): fica o nó provisório, como antes de ser lido — o
      // mesmo estado de quando o importador é indexado depois. Sem isso, o mapa dependia da ordem.
      const importers = this.graph
        .inEdges(fileId)
        .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'imports')
        .map((e) => this.graph.source(e));
      this.removeFile(fsPath);
      for (const importer of importers) this.addImportEdge(importer, fsPath);
      return;
    }
    try {
      const ext = extOf(fsPath);
      if (ext === '.css') {
        if (this.web.css) this.updateCssFile(fsPath, text, this.web.css);
      } else if (ext === '.html' || ext === '.htm') {
        if (this.web.html) this.updateHtmlFile(fsPath, text, this.web.html);
      }
      else {
        const frontend = this.frontends.find((f) => f.extensions.includes(ext));
        if (frontend) this.updateCodeFile(fsPath, text, frontend);
      }
    } catch (err) {
      this.host.log(`[CodeGraph] falha inesperada atualizando o grafo de ${fsPath}: ${err}`);
    }
  }

  /** Arquivo deletado de verdade — remove o nó e tudo ligado a ele (diferente de reparsear). */
  removeFile(fsPath: string): void {
    const fileId = toFileId(fsPath);
    const implemented = this.implementedNames(fileId);
    const classes = this.classNames(fileId);
    const globals = this.scopes.get(fileId)?.global;
    this.clearFileContents(fileId);
    this.rawCalls.delete(fileId);
    this.pendingImports.delete(fileId);
    this.moduleInfo.delete(fileId);
    this.specTargets.delete(fileId);
    this.coverage.delete(fileId);
    this.scopes.delete(fileId);
    if (this.graph.hasNode(fileId)) this.graph.dropNode(fileId);
    this.relinkInterfaceDependents(implemented, fileId);
    this.relinkTypeDependents(classes, fileId, (globals?.length ?? 0) > 0);
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
    // `edges(a, b)` do graphology ignora a direção; `outEdges(a, b)` é só de `a` para `b`.
    return this.graph.outEdges(source, target).some((e) => this.graph.getEdgeAttribute(e, 'type') === type);
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
    // Só `calls` provadas: passar uma função como valor (`references`) não é um laço de execução, e um
    // ciclo que só fecha por uma ligação por nome (`heuristic`) é palpite, não prova (Q2 do plano).
    return findCycleThrough(
      {
        hasNode: (id) => this.graph.hasNode(id),
        outNeighbors: (id) =>
          this.graph
            .outEdges(id)
            .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'calls' && !this.graph.getEdgeAttribute(e, 'heuristic'))
            .map((e) => this.graph.target(e)),
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
        // todas as funções no mesmo arquivo: recursão (em geral de propósito), não acoplamento entre módulos
        recursion: cycle.every((id) => {
          const a = this.graph.getNodeAttributes(id);
          return isSymbolNode(a) && a.file === attrs.file;
        }),
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

  private updateCodeFile(fsPath: string, text: string, frontend: LanguageFrontend): void {
    const fileId = toFileId(fsPath);

    let tree;
    try {
      tree = frontend.parse(text, fsPath);
    } catch (err) {
      this.host.log(`[CodeGraph] erro de parse em ${fsPath}: ${err}`);
      return;
    }

    try {
      const root = tree.rootNode;
      const implementedBefore = this.implementedNames(fileId);
      const classesBefore = this.classNames(fileId);
      const globalsBefore = (this.scopes.get(fileId)?.global ?? []).join('|');
      const { symbols, module, valueCalls, calls, topHash, scope } = frontend.extract(root, fileId);
      if (scope) this.scopes.set(fileId, scope);
      else this.scopes.delete(fileId);
      this.resetFileNode(fileId, { kind: 'file', path: fsPath, topHash });
      for (const sym of symbols) {
        this.graph.mergeNode(sym.id, {
          kind: sym.kind,
          name: sym.name,
          file: fileId,
          startLine: sym.startLine,
          endLine: sym.endLine,
          signature: sym.signature,
          bodyHash: sym.bodyHash,
          ...(sym.container !== undefined && { container: sym.container }),
          ...(sym.extends !== undefined && { extends: sym.extends }),
          ...(sym.implements !== undefined && { implements: sym.implements }),
          ...(sym.fields !== undefined && { fields: sym.fields }),
          ...(sym.extendsArg !== undefined && { extendsArg: sym.extendsArg }),
          ...(sym.fieldArgs !== undefined && { fieldArgs: sym.fieldArgs }),
          ...(sym.properties !== undefined && { properties: sym.properties }),
          ...(sym.returns !== undefined && { returns: sym.returns }),
          ...(sym.namespace !== undefined && { namespace: sym.namespace }),
          ...(sym.extensionOf !== undefined && { extensionOf: sym.extensionOf }),
          ...(sym.handles !== undefined && { handles: sym.handles }),
        });
        this.graph.mergeEdgeWithKey(`${fileId}->defines->${sym.id}`, fileId, sym.id, { type: 'defines' });
      }

      const info: FileModule = { ...module, valueCalls };
      this.moduleInfo.set(fileId, info);
      if (scope) this.linkPackages(fileId, info.specs);
      else this.linkImports(fileId, fsPath, info.specs);

      this.rawCalls.set(fileId, calls);
      this.relinkCalls(fileId);
      // Os símbolos deste arquivo acabaram de ser recriados (com ids novos se as linhas mudaram) —
      // quem importa este arquivo (direto ou via barrel) precisa religar as chamadas que apontavam pra cá.
      this.relinkImporters(fileId);
      // ...e quem chega aqui por uma interface (`repo: IRepo` → `class PgRepo implements IRepo`) também.
      this.relinkInterfaceDependents(new Set([...implementedBefore, ...this.implementedNames(fileId)]), fileId);
      // ...e, no C#/Java, quem resolveu pelo nome uma classe que este arquivo tinha ou passou a ter
      // (um `global using` novo ou removido muda o que todo arquivo enxerga)
      const globalsChanged = globalsBefore !== (scope?.global ?? []).join('|');
      this.relinkTypeDependents(new Set([...classesBefore, ...this.classNames(fileId)]), fileId, globalsChanged);

      for (const listener of this.parsedListeners) {
        try {
          listener({ id: fileId, fsPath, language: frontend.language, root });
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

  /** C#/Java: cada especificador é um pacote (os tipos de fora que o arquivo usa), nunca um arquivo. */
  private linkPackages(fileId: string, specs: string[]): void {
    const targets = new Map<string, SpecTarget>();
    for (const spec of specs) {
      const pkg = packageNodeId(spec);
      this.graph.mergeNode(pkg, { kind: 'package', name: spec });
      this.graph.mergeEdgeWithKey(`${fileId}->imports->${pkg}`, fileId, pkg, { type: 'imports' });
      targets.set(spec, { kind: 'package', name: spec });
    }
    this.specTargets.set(fileId, targets);
    this.pendingImports.delete(fileId);
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
    let typeIndex: Map<string, string[]> | undefined;
    let extensionIndex: Map<string, string[]> | undefined;
    let handlerIndex: Map<string, string[]> | undefined;
    let globals: string[] | undefined;
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
      typesNamed: (name) => {
        let dependents = this.typeDependents.get(name);
        if (!dependents) this.typeDependents.set(name, (dependents = new Set()));
        dependents.add(fileId);
        if (!typeIndex) {
          typeIndex = new Map();
          this.graph.forEachNode((id, attrs) => {
            if (attrs.kind !== 'class' || attrs.namespace === undefined) return;
            const list = typeIndex!.get(attrs.name);
            if (list) list.push(id);
            else typeIndex!.set(attrs.name, [id]);
          });
        }
        return typeIndex.get(name) ?? [];
      },
      globalUsings: () => (globals ??= [...new Set([...this.scopes.values()].flatMap((s) => s.global ?? []))]),
      extensionsNamed: (name) => {
        const key = `${EXTENSION_KEY}${name}`;
        let dependents = this.typeDependents.get(key);
        if (!dependents) this.typeDependents.set(key, (dependents = new Set()));
        dependents.add(fileId);
        if (!extensionIndex) {
          extensionIndex = new Map();
          this.graph.forEachNode((id, attrs) => {
            if (attrs.kind !== 'method' || !attrs.extensionOf) return;
            const list = extensionIndex!.get(attrs.name);
            if (list) list.push(id);
            else extensionIndex!.set(attrs.name, [id]);
          });
        }
        return extensionIndex.get(name) ?? [];
      },
      handlersOf: (name) => {
        const key = `${MESSAGE_KEY}${name}`;
        let dependents = this.typeDependents.get(key);
        if (!dependents) this.typeDependents.set(key, (dependents = new Set()));
        dependents.add(fileId);
        if (!handlerIndex) {
          handlerIndex = new Map();
          this.graph.forEachNode((id, attrs) => {
            if (attrs.kind !== 'class') return;
            for (const m of attrs.handles ?? []) {
              const simple = m.slice(m.lastIndexOf('.') + 1);
              const list = handlerIndex!.get(simple);
              if (list) list.push(id);
              else handlerIndex!.set(simple, [id]);
            }
          });
        }
        return handlerIndex.get(name) ?? [];
      },
    };
  }

  private resolveCall(fileId: string, call: CallDesc, ctx: ResolutionContext, depth = 0): CallResolution {
    const r = this.resolveCallBy(fileId, call, ctx, depth);
    return call.message ? this.dispatched(fileId, r, call.message, ctx) : r;
  }

  /**
   * C#: `_mediator.Send(new Create.Command())` resolve para o pacote do MediatR, mas quem roda é o `Handle` de
   * quem trata `Create.Command`. Nome igual → provado; só o nome simples igual (`Command` × `Create.Command`) → por nome.
   */
  private dispatched(fileId: string, r: CallResolution, message: string, ctx: ResolutionContext): CallResolution {
    if (r.outcome !== 'callsExternal' || r.package !== 'MediatR') return r;
    const simple = message.slice(message.lastIndexOf('.') + 1);
    const handlers = ctx.handlersOf(simple);
    // a mensagem e a de cada handler resolvidas pelo índice de tipos, cada uma no arquivo onde está escrita:
    // `Create.Command` de Articles e o de Comments são classes diferentes
    const wanted = new Set(this.resolveType(fileId, message.split('.'), ctx, false).classes);
    const exact = handlers.filter((id) => {
      const a = this.graph.getNodeAttributes(id);
      if (!isSymbolNode(a)) return false;
      return (a.handles ?? []).some((m) => this.resolveType(a.file, m.split('.'), ctx, false).classes.some((c) => wanted.has(c)));
    });
    // sem a classe da mensagem (tipo não resolvido), só o nome simples: palpite
    const chosen = exact.length > 0 ? exact : wanted.size > 0 ? [] : handlers;
    const targets = chosen.flatMap((cls) => {
      const a = this.graph.getNodeAttributes(cls);
      if (!isSymbolNode(a)) return [];
      return this.ownedSymbols(a.file).filter((id) => {
        const m = this.graph.getNodeAttributes(id);
        return isSymbolNode(m) && m.kind === 'method' && m.container === a.name && m.name === 'Handle';
      });
    });
    if (targets.length === 0) return r;
    return { outcome: exact.length > 0 ? 'callsResolved' : 'callsHeuristic', targets };
  }

  private resolveCallBy(fileId: string, call: CallDesc, ctx: ResolutionContext, depth = 0): CallResolution {
    // `f()` com `f` variável local (parâmetro, callback) não é nenhum símbolo do projeto;
    // `obj.m()` com `obj` local sem tipo ainda pode cair no fallback por nome.
    if (call.shadowed) return call.object && !call.opaque ? this.guess(call, ctx) : NATIVE;

    if (call.dynamic) return this.guess(call, ctx);

    if (call.module !== undefined) {
      // `require('./routes/auth')(app)`: a função é o `module.exports` daquele arquivo
      const target = this.specTargets.get(fileId)?.get(call.module);
      if (target?.kind === 'package') return this.external(target.name);
      return target?.kind === 'file' ? this.found(this.resolveExport(target.id, 'default')) : UNRESOLVED;
    }

    if (call.ctor && call.receiver && 'type' in call.receiver) return this.resolveConstructor(fileId, call.receiver.type, ctx);

    if (call.receiver) {
      const byType =
        'call' in call.receiver
          ? this.resolveReturnMember(fileId, call.receiver.call, call.receiver.rest, call.name, ctx, depth)
          : this.resolveMember(fileId, call.receiver.type, call.receiver.rest, call.name, ctx);
      // documento de um modelo do Mongoose (`(await User.findById(id)).transform()`): o método pode ser do schema
      if (byType?.outcome === 'callsExternal' && call.receiver.rest.length === 0) {
        const model = this.modelOf(fileId, call, 'caller' in call ? (call.caller as string) : undefined, ctx);
        const own = model?.document ? this.modelMember(model.file, model.produced, 'methods', [], call.name) : undefined;
        if (own) return own;
      }
      // C#: receptor de tipo de fora (`List<Order>`, `IEndpointRouteBuilder`) com um método de extensão do projeto para
      // esse tipo declarado: a chamada é dele (o método da instância venceria, mas um tipo de fora não tem o do projeto)
      if (byType && (byType.outcome === 'callsExternal' || byType.outcome === 'unbound') && 'type' in call.receiver && this.scopes.has(fileId)) {
        const typeName = this.receiverTypeName(fileId, call.receiver, ctx);
        const own = typeName
          ? ctx.extensionsNamed(call.name).filter((id) => {
              const m = this.graph.getNodeAttributes(id);
              return isSymbolNode(m) && m.extensionOf?.at(-1) === typeName;
            })
          : [];
        if (own.length > 0) return { outcome: 'callsResolved', targets: own };
      }
      if (byType) return byType;
    }

    const [root, ...rest] = call.object ?? [];
    if (root === 'this' || root === 'super') {
      // `this.campo.m()` com o campo sem tipo: `m` é do objeto guardado no campo, nunca da própria
      // classe (`this.diagnostics.set()` não é o `set()` de quem a guarda — Q2 do plano).
      if (rest.length > 0 && call.receiver && !('call' in call.receiver)) {
        const own = new Set(this.resolveType(fileId, call.receiver.type, ctx).classes);
        return this.guess(call, ctx, (id) => {
          const owner = this.containerId(id);
          return !owner || !own.has(owner);
        });
      }
      // `this.findOne()` num estático do Mongoose (`userSchema.statics.x = function`): `this` é o modelo
      // (num método ou hook, `this.constructor.hashIP()` é o modelo: o estático)
      const viaModel = rest.length === 1 && rest[0] === 'constructor';
      const schema = root === 'this' && (rest.length === 0 || viaModel) && 'caller' in call ? this.schemaOf(call.caller as string) : undefined;
      if (schema && (!viaModel || schema.kind === 'methods')) {
        const own = this.modelMember(schema.file, schema.produced, viaModel ? 'statics' : schema.kind, [], call.name);
        return own ?? this.resolveCall(schema.file, schema.produced, ctx, depth + 1);
      }
      return this.guess(call, ctx);
    }
    const binding = ctx.bindings(fileId).get(root ?? call.name);

    if (binding) {
      const target = this.specTargets.get(fileId)?.get(binding.spec);
      if (!target || target.kind === 'unresolved') return UNRESOLVED;
      if (target.kind === 'package') return this.external(target.name);

      if (!call.object) {
        // `b()` com `import { a as b }` / `import b from` / `const b = require()`
        const exported = binding.imported === '*' ? 'default' : binding.imported;
        const ids = this.resolveExport(target.id, exported);
        if (ids.length > 0) return this.found(ids);
        // `new User()` com `module.exports = mongoose.model('User', s)`: o valor (e o que ele constrói) é do pacote
        const loc = this.resolveExportLocal(target.id, exported, new Set());
        return (loc && (this.aliasedCall(loc.file, loc.local, [], ctx, depth) ?? this.externalValue(loc.file, loc.local, ctx, depth))) ?? UNRESOLVED;
      }
      // `ns.fn()` com `import * as ns` / `const ns = require()`; `ns.obj.m()` segue a instância exportada
      if (binding.imported === '*') return this.memberOfModule(target.id, rest, call.name, ctx, !!binding.require);
      // `orderService.create()` com `import { orderService }` — instância, objeto ou classe (estático)
      return this.resolveMemberOfExport(target.id, binding.imported, rest, call.name, ctx);
    }

    // `const User = db.user` no topo: `User.findOne()` é `db.user.findOne()`
    const aliased = this.aliasedCall(fileId, root ?? call.name, call.object ? [...rest, call.name] : [], ctx, depth);
    if (aliased) return aliased;

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
    const origin = call.object
      ? this.valueOrigin(fileId, call.object, call.scope, ctx)
      : call.chainRoot && { file: fileId, name: call.chainRoot.name, ...(call.chainRoot.scope === 'local' && { local: true as const }) };
    // modelo (Mongoose) ou entidade (TypeORM) por trás do receptor: o alvo da operação de banco (`User.findOne` → `User`)
    const produced = r.outcome === 'callsExternal' ? this.modelOf(fileId, call, call.caller, ctx)?.produced : undefined;
    const model =
      produced?.args?.[0]?.kind === 'string' ? produced.args[0].value : r.outcome === 'callsExternal' ? this.entityOf(fileId, call, ctx) : undefined;
    const array = call.loop && this.valueOrigin(fileId, [call.loop.array], undefined, ctx);
    const loop = array && this.moduleInfo.get(array.file)?.arrays.has(array.name) ? { array, param: call.loop!.param } : undefined;
    const receiverCall = this.scopes.has(fileId) ? this.receiverCallOf(fileId, call, ctx) : undefined;
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
      ...(loop && { loop }),
      ...(model && { model }),
      ...(call.receiverParam !== undefined && { receiverParam: call.receiverParam }),
      ...(call.decorates && { decorates: call.decorates }),
      ...(receiverCall && { receiverCall }),
    };
  }

  /** C#/Java: a cadeia de chamadas que produziu o receptor (ver `CallSite.receiverCall`). */
  private receiverCallOf(fileId: string, call: CallDesc, ctx: ResolutionContext, depth = 0): ReceiverCall | undefined {
    if (!call.receiver || !('call' in call.receiver) || depth > 16) return undefined;
    const inner = call.receiver.call;
    const next = this.receiverCallOf(fileId, inner, ctx, depth + 1);
    return { name: inner.name, args: (inner.args ?? []).map((a) => this.resolveArg(fileId, a, ctx)), ...(next && { receiverCall: next }) };
  }

  /**
   * Os itens de uma lista literal do topo de um arquivo (`const routes = [{ path: '/auth', route: authRoute }]`),
   * com os nomes resolvidos como os argumentos de uma chamada: `route` sai com a origem do `authRoute`.
   */
  arrayItems(array: ValueOrigin): Array<Record<string, CallArg>> {
    const items = this.moduleInfo.get(array.file)?.arrays.get(array.name);
    if (!items) return [];
    const ctx = this.resolutionContext(array.file);
    return items.map((item) => {
      const out: Record<string, CallArg> = {};
      for (const [key, v] of Object.entries(item)) {
        if (v.kind === 'string') out[key] = v;
        else {
          const ref: CallDesc = v.chain.length === 1 ? { name: v.chain[0]! } : { name: v.chain.at(-1)!, object: v.chain.slice(0, -1) };
          // sem `scope`: o nome pode ser import (`const authRoute = require(...)`) — o `valueOrigin` segue até a declaração
          out[key] = this.resolveArg(array.file, { kind: 'name', chain: v.chain, ref }, ctx);
        }
      }
      return out;
    });
  }

  private publicResolution(r: CallResolution): { outcome: PublicCallOutcome; targets: string[]; package?: string } {
    return {
      outcome: PUBLIC_OUTCOME[r.outcome],
      targets: r.outcome === 'callsExternal' ? [] : r.targets,
      ...(r.package !== undefined && { package: r.package }),
    };
  }

  private resolveArg(fileId: string, arg: RawArg, ctx: ResolutionContext): CallArg {
    if (arg.kind === 'call') {
      // `app.use('/orders', require('./routes/orders'))`: o valor é o `module.exports` daquele arquivo
      const target = arg.spec !== undefined ? this.specTargets.get(fileId)?.get(arg.spec) : undefined;
      const loc = target?.kind === 'file' ? this.resolveExportLocal(target.id, 'default', new Set()) : undefined;
      return { kind: 'call', callee: arg.callee, ...(loc && { origin: { file: loc.file, name: loc.local } }), ...(arg.functions && { functions: arg.functions }) };
    }
    if (arg.kind === 'array') return { kind: 'array', items: arg.items.map((a) => this.resolveArg(fileId, a, ctx)) };
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
    // `const User = db.user`: a origem é a do membro
    const alias = this.moduleInfo.get(fileId)?.aliases.get(root);
    if (alias && chain.length < 16) return this.valueOrigin(fileId, [...alias, ...chain.slice(1)], undefined, ctx);
    if (scope === 'module') return { file: fileId, name: root };
    const binding = ctx.bindings(fileId).get(root);
    if (!binding) return this.declaresTopLevel(fileId, root) || this.moduleInfo.get(fileId)?.arrays.has(root) ? { file: fileId, name: root } : undefined;
    const target = this.specTargets.get(fileId)?.get(binding.spec);
    if (target?.kind !== 'file') return undefined;
    // `import * as routes` + `routes.orders` → o export `orders`; sem membro, o namespace não é um valor declarado
    const exported = binding.imported === '*' ? next : binding.imported;
    const loc = exported ? this.resolveExportLocal(target.id, exported, new Set()) : undefined;
    if (loc) return { file: loc.file, name: loc.local };
    // `const userRoutes = require('./user.route')` com `module.exports = router` lá: o valor é o `router`
    if (binding.require && this.moduleInfo.get(target.id)?.exports.has('default')) {
      const value = this.resolveExportLocal(target.id, 'default', new Set());
      // `db.user` com `db.user = require('./user.model')` lá: o valor é o daquele módulo
      const spec = value && next ? this.moduleInfo.get(value.file)?.objectRequires.get(`${value.local}.${next}`) : undefined;
      const member = spec !== undefined ? this.specTargets.get(value!.file)?.get(spec) : undefined;
      const inner = member?.kind === 'file' ? this.resolveExportLocal(member.id, 'default', new Set()) : undefined;
      if (inner) return { file: inner.file, name: inner.local };
      return value && { file: value.file, name: value.local };
    }
    return undefined;
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
    if (inner.spec !== undefined && !inner.shadowed) {
      // `require('express').Router()` / `require('./svc').create()`: o valor é o módulo
      const target = this.specTargets.get(fileId)?.get(inner.spec);
      if (!target || target.kind === 'unresolved') return UNRESOLVED;
      if (target.kind === 'package') return this.external(target.name);
      if (rest.length === 0) return this.found(this.resolveExport(target.id, method));
      return this.resolveMemberOfExport(target.id, rest[0]!, rest.slice(1), method, ctx);
    }
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

  /**
   * `User.get()` com `const User = mongoose.model('User', userSchema)`: o método é o estático que o
   * projeto declara em `userSchema.statics = { get() {} }`. O que não estiver lá (`findOne`) é do pacote.
   */
  private modelMember(fileId: string, produced: CallDesc, kind: 'statics' | 'methods', rest: string[], method: string): CallResolution | undefined {
    const schema = produced.args?.[1];
    if (produced.name !== 'model' || rest.length > 0 || schema?.kind !== 'name' || schema.chain.length !== 1) return undefined;
    const container = `${schema.chain[0]}.${kind}`;
    const ids = this.ownedSymbols(fileId).filter((id) => {
      const m = this.graph.getNodeAttributes(id);
      return isSymbolNode(m) && m.container === container && m.name === method;
    });
    return ids.length > 0 ? { outcome: 'callsResolved', targets: ids } : undefined;
  }

  /**
   * O símbolo é um estático ou método de um schema do Mongoose (`userSchema.statics.get`) que vira modelo
   * no mesmo arquivo (`mongoose.model('User', userSchema)`)? Devolve a chamada que cria o modelo.
   */
  private schemaOf(symbolId: string): { file: string; produced: CallDesc; kind: 'statics' | 'methods' } | undefined {
    const attrs = this.graph.hasNode(symbolId) ? this.graph.getNodeAttributes(symbolId) : undefined;
    if (!attrs || !isSymbolNode(attrs) || !attrs.container) return undefined;
    const dot = attrs.container.lastIndexOf('.');
    const suffix = attrs.container.slice(dot + 1);
    // hook (`schema.pre('save', fn)`): o `this` é o documento, como num método
    const kind = suffix === 'hooks' ? 'methods' : suffix;
    if (dot <= 0 || (kind !== 'statics' && kind !== 'methods')) return undefined;
    const schema = attrs.container.slice(0, dot);
    for (const produced of this.moduleInfo.get(attrs.file)?.valueCalls.values() ?? []) {
      const arg = produced.args?.[1];
      if (produced.name === 'model' && arg?.kind === 'name' && arg.chain.length === 1 && arg.chain[0] === schema) return { file: attrs.file, produced, kind };
    }
    return undefined;
  }

  /**
   * Nome do modelo do Mongoose por trás do receptor de uma chamada: `User.findOne()` (com `User =
   * mongoose.model('User', s)`, mesmo importado), `this.findOne()` num estático, e o documento que um
   * modelo devolve (`const user = await User.findById(id); user.save()` / `new User(body).save()`).
   */
  private modelOf(fileId: string, call: CallDesc, caller: string | undefined, ctx: ResolutionContext, depth = 0): ModelRef | undefined {
    if (depth > 4) return undefined;
    if (call.receiver && 'call' in call.receiver) {
      // documento: o receptor é o resultado de `new User()` ou de `User.findById()`
      // (inclusive pela cadeia da consulta: `User.findOne(q).populate('x').exec()`)
      const inner = call.receiver.call;
      const chained = inner.object || (inner.receiver && 'call' in inner.receiver);
      const model = chained ? this.modelOf(fileId, inner, caller, ctx, depth + 1) : this.modelOfValue(fileId, [inner.name], inner.scope, ctx);
      return model && { ...model, document: true };
    }
    // `const user = new User(b); user.save()`: o receptor tem o "tipo" `User`, que é o modelo
    if (call.receiver && 'type' in call.receiver && call.receiver.type.length === 1 && call.receiver.rest.length === 0 && call.object?.[0] !== 'this') {
      const model = this.modelOfValue(fileId, call.receiver.type, undefined, ctx);
      return model && { ...model, document: true };
    }
    const root = call.object?.[0];
    if (root === 'this') {
      const schema = caller ? this.schemaOf(caller) : undefined;
      return schema && { file: schema.file, produced: schema.produced, document: schema.kind === 'methods' };
    }
    return root && call.object!.length === 1 ? this.modelOfValue(fileId, [root], call.scope, ctx) : undefined;
  }

  /**
   * Entidade do TypeORM por trás do receptor: o campo `private repo: Repository<User>` (NestJS), o repositório
   * próprio (`class PetRepository extends Repository<Pet>`, num campo ou herdado) ou `getRepository(Pet)`.
   */
  private entityOf(fileId: string, call: CallDesc, ctx: ResolutionContext, depth = 0): string | undefined {
    const receiver = call.receiver;
    if (!receiver) return undefined;
    if ('call' in receiver) {
      const first = receiver.call.args?.[0];
      if (receiver.call.name === 'getRepository') return first?.kind === 'name' ? first.chain.at(-1) : undefined;
      // C#/Java: a consulta encadeada (`_db.Orders.Where(...).FirstOrDefaultAsync()`) é da entidade do começo da cadeia
      return this.scopes.has(fileId) && depth < 16 ? this.entityOf(fileId, receiver.call, ctx, depth + 1) : undefined;
    }
    const attrsOf = (id: string) => {
      const a = this.graph.hasNode(id) ? this.graph.getNodeAttributes(id) : undefined;
      return a && isSymbolNode(a) ? a : undefined;
    };
    let classes = this.resolveType(fileId, receiver.type, ctx).classes;
    for (const [i, field] of receiver.rest.entries()) {
      if (i === receiver.rest.length - 1) {
        const arg = classes.map((c) => attrsOf(c)?.fieldArgs?.[field]).find((a) => a);
        if (arg) return arg;
      }
      classes = classes.flatMap((c) => this.fieldType(c, field, ctx, new Set())?.classes ?? []);
    }
    // o próprio repositório: `extends Repository<Pet>`, subindo pelas bases do projeto
    const seen = new Set<string>();
    while (classes.length > 0) {
      const arg = classes.map((c) => attrsOf(c)?.extendsArg).find((a) => a);
      if (arg) return arg;
      for (const c of classes) seen.add(c);
      classes = classes.flatMap((c) => {
        const a = attrsOf(c);
        return a?.extends ? this.resolveType(a.file, a.extends, ctx, false).classes.filter((b) => !seen.has(b)) : [];
      });
    }
    return undefined;
  }

  private modelOfValue(fileId: string, chain: string[], scope: Scope | undefined, ctx: ResolutionContext): ModelRef | undefined {
    const origin = this.valueOrigin(fileId, chain, scope, ctx);
    if (!origin || origin.local) return undefined;
    const produced = this.moduleInfo.get(origin.file)?.valueCalls.get(origin.name);
    return produced?.name === 'model' ? { file: origin.file, produced, document: false } : undefined;
  }

  /**
   * `local` é apelido no topo de `fileId` (`const User = db.user`, `export const { useX } = api`)? Resolve a
   * chamada como se fosse feita pelo caminho de verdade, com `tail` (membros + método) depois dele.
   */
  private aliasedCall(fileId: string, local: string, tail: string[], ctx: ResolutionContext, depth: number): CallResolution | undefined {
    const alias = depth < 8 ? this.moduleInfo.get(fileId)?.aliases.get(local) : undefined;
    if (!alias) return undefined;
    const chain = [...alias, ...tail];
    return this.resolveCall(fileId, { name: chain.at(-1)!, object: chain.slice(0, -1) }, ctx, depth + 1);
  }

  /** O valor `local` de `fileId` sai de uma chamada a um pacote (`mongoose.model(...)`)? Então é desse pacote. */
  private externalValue(fileId: string, local: string, ctx: ResolutionContext, depth: number): CallResolution | undefined {
    const produced = this.moduleInfo.get(fileId)?.valueCalls.get(local);
    const key = `${fileId}|${local}`;
    if (!produced || depth > 8 || this.valueCallStack.has(key)) return undefined;
    this.valueCallStack.add(key);
    try {
      const r = this.resolveCall(fileId, produced, ctx, depth + 1);
      return r.outcome === 'callsExternal' ? r : undefined;
    } finally {
      this.valueCallStack.delete(key);
    }
  }

  /** Fallback por nome (comportamento antigo): o arquivo + o que ele importa. */
  private guess(call: CallDesc, ctx: ResolutionContext, keep: (id: string) => boolean = () => true): CallResolution {
    const guessed = ctx.legacy(call.name).filter(keep);
    return guessed.length > 0 ? { outcome: 'callsHeuristic', targets: guessed } : { outcome: 'unbound', targets: [] };
  }

  /** Classe dona de um método (`a.ts#Svc.save` → `a.ts#Svc`); funções soltas não têm. */
  private containerId(symbolId: string): string | undefined {
    const attrs = this.graph.hasNode(symbolId) ? this.graph.getNodeAttributes(symbolId) : undefined;
    return attrs && isSymbolNode(attrs) && attrs.container ? `${attrs.file}#${attrs.container}` : undefined;
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
    // C#/Java: `App.Util.Fmt.Do()` / `OrderService.Instance.Do()` — o tipo é o maior prefixo que resolve; o resto são membros
    if (type.length > 1 && this.scopes.has(fileId)) {
      for (let k = type.length; k >= 1; k--) {
        const r = this.resolveType(fileId, type.slice(0, k), ctx);
        if (r.classes.length === 0 && !r.external) continue;
        rest = [...type.slice(k), ...rest];
        type = type.slice(0, k);
        break;
      }
    }
    const resolved = this.resolveType(fileId, type, ctx);
    if (resolved.external) return this.external(resolved.external);
    if (resolved.classes.length === 0) {
      // `const user = new User(b)` com `User` valor de pacote (`mongoose.model(...)`), não classe: o objeto é do pacote
      const ctor = type.length === 1 ? this.resolveCall(fileId, { name: type[0]! }, ctx, 1) : undefined;
      return ctor?.outcome === 'callsExternal' ? ctor : NATIVE;
    }
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
    if (unknownBase) return NATIVE;
    // C#: método de extensão do projeto para a classe, uma base ou uma interface dela (`order.Validate()`)
    const extensions = this.extensionsFor(current, method, ctx);
    return extensions.length > 0 ? { outcome: 'callsResolved', targets: extensions } : UNRESOLVED;
  }

  /** Métodos de extensão `method` cujo `this` é uma das classes, uma base delas ou uma interface que implementam. */
  private extensionsFor(classes: string[], method: string, ctx: ResolutionContext): string[] {
    const candidates = ctx.extensionsNamed(method);
    if (candidates.length === 0) return [];
    const names = new Set<string>();
    const seen = new Set<string>();
    let level = classes;
    while (level.length > 0) {
      const next: string[] = [];
      for (const id of level) {
        const a = this.graph.hasNode(id) ? this.graph.getNodeAttributes(id) : undefined;
        if (!a || !isSymbolNode(a) || seen.has(id)) continue;
        seen.add(id);
        names.add(a.name);
        for (const i of a.implements ?? []) names.add(i);
        if (a.extends) {
          names.add(a.extends.at(-1)!);
          next.push(...this.resolveType(a.file, a.extends, ctx, false).classes);
        }
      }
      level = next;
    }
    return candidates.filter((id) => {
      const m = this.graph.getNodeAttributes(id);
      return isSymbolNode(m) && !!m.extensionOf && names.has(m.extensionOf.at(-1)!);
    });
  }

  /**
   * O nome do tipo DECLARADO do receptor (`List` em `List<Order> list; list.ToDto()`), seguindo campos.
   * É o que liga um método de extensão do projeto a um tipo de fora sem adivinhar.
   */
  private receiverTypeName(fileId: string, receiver: { type: TypeRef; rest: string[] }, ctx: ResolutionContext): string | undefined {
    if (receiver.rest.length === 0) return receiver.type.at(-1);
    let classes = this.resolveType(fileId, receiver.type, ctx).classes;
    for (const [i, field] of receiver.rest.entries()) {
      const declared = classes.map((c) => this.declaredField(c, field, new Set())).find((d) => d);
      if (!declared) return undefined;
      if (i === receiver.rest.length - 1) return declared.type.at(-1);
      classes = this.resolveType(declared.file, declared.type, ctx).classes;
    }
    return undefined;
  }

  /** O tipo como está escrito no campo `field` da classe (ou de uma base do projeto) e o arquivo onde está escrito. */
  private declaredField(classId: string, field: string, seen: Set<string>): { type: TypeRef; file: string } | undefined {
    const attrs = this.graph.hasNode(classId) ? this.graph.getNodeAttributes(classId) : undefined;
    if (!attrs || !isSymbolNode(attrs) || seen.has(classId)) return undefined;
    seen.add(classId);
    const own = attrs.fields?.[field];
    if (own) return { type: own, file: attrs.file };
    return undefined;
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
    const base = this.resolveType(attrs.file, attrs.extends, ctx, false);
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
    // C#/Java: declarado na classe com tipo nativo (`string[]`, `List<T>`, `int`): não é do projeto nem da base de pacote
    if (attrs.properties?.includes(field) && this.scopes.has(attrs.file)) return { classes: [] };
    if (!attrs.extends) return undefined;
    const base = this.resolveType(attrs.file, attrs.extends, ctx, false);
    // C#/Java: campo herdado de uma base de pacote (`_db.Database` com `Db : DbContext`) é do pacote
    if (base.external && this.scopes.has(attrs.file)) return { classes: [], external: base.external };
    for (const b of base.classes) {
      const t = this.fieldType(b, field, ctx, seen);
      if (t) return t;
    }
    return undefined;
  }

  /**
   * Classe(s) que um nome de tipo representa no arquivo: import (inclusive `ns.Tipo`), classe
   * local, ou — se for uma interface — as classes que a implementam.
   */
  private resolveType(fileId: string, type: TypeRef, ctx: ResolutionContext, implementers = true): ResolvedType {
    // `implementers = false` na base de uma classe: no C# a 1ª base pode ser uma interface, e cair nas
    // implementações dela faria a classe "herdar" os métodos das irmãs.
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
      return { classes: classes.length > 0 || !implementers ? classes : ctx.implementers(exported) };
    }
    const scope = this.scopes.get(fileId);
    if (scope) return this.resolveScopedType(scope, type, ctx, implementers);
    if (tail.length > 0) return { classes: [] };
    const local = this.topLevelByName(fileId, head).filter((id) => this.graph.getNodeAttribute(id, 'kind') === 'class');
    return { classes: local.length > 0 || !implementers ? local : ctx.implementers(head) };
  }

  /**
   * C#/Java: as classes que um nome de tipo representa pelos namespaces que o arquivo enxerga.
   * `OrderService` → as de nome `OrderService` num namespace visível (o próprio e os de cima, os
   * `using`, os `global using` e o global); `Services.OrderService` / `App.Services.OrderService` →
   * qualificado, absoluto ou relativo a um visível; `Svc` com `using Svc = App.Services.OrderService;`.
   */
  private resolveScopedType(scope: NamespaceScope, type: TypeRef, ctx: ResolutionContext, implementers: boolean): ResolvedType {
    const alias = Object.hasOwn(scope.aliases, type[0]!) ? scope.aliases[type[0]!] : undefined;
    const full = alias ? [...alias.split('.'), ...type.slice(1)] : type;
    const name = full.at(-1)!;
    const qualifier = full.slice(0, -1).join('.');
    const roots = alias ? [''] : ['', ...scope.visible, ...ctx.globalUsings()];
    const wanted = new Set(qualifier ? roots.map((r) => (r ? `${r}.${qualifier}` : qualifier)) : roots);
    // o caminho de uma classe é o namespace + as classes de fora (aninhada: `App.Create` + `Command`)
    const pathOf = (attrs: SymbolNodeAttrs) => (attrs.container ? `${attrs.namespace ? `${attrs.namespace}.` : ''}${attrs.container}` : attrs.namespace!);
    const candidates = ctx.typesNamed(name).flatMap((id) => {
      const attrs = this.graph.getNodeAttributes(id);
      return isSymbolNode(attrs) && attrs.namespace !== undefined ? [{ id, attrs }] : [];
    });
    let classes = candidates.filter((c) => wanted.has(pathOf(c.attrs))).map((c) => c.id);
    // sem qualificar, um tipo aninhado é visível dentro da classe de fora — e o arquivo não diz de qual classe veio o
    // nome: vale o aninhado de um namespace visível (como antes de o grafo saber das classes de fora)
    if (classes.length === 0 && !qualifier) classes = candidates.filter((c) => c.attrs.container && wanted.has(c.attrs.namespace!)).map((c) => c.id);
    if (classes.length > 0 || !implementers || full.length > 1) return { classes };
    return { classes: ctx.implementers(name) };
  }

  /** C#/Java: `new X()` → o construtor de `X` (ou a classe, sem construtor declarado); tipo de pacote → externa; nativo → nada. */
  private resolveConstructor(fileId: string, type: TypeRef, ctx: ResolutionContext): CallResolution {
    const t = this.resolveType(fileId, type, ctx, false);
    if (t.external) return this.external(t.external);
    if (t.classes.length === 0) return NATIVE;
    const targets = t.classes.flatMap((cls) => {
      const a = this.graph.getNodeAttributes(cls);
      if (!isSymbolNode(a)) return [];
      const ctors = this.ownedSymbols(a.file).filter((id) => {
        const m = this.graph.getNodeAttributes(id);
        return isSymbolNode(m) && m.kind === 'method' && m.container === a.name && m.name === a.name;
      });
      return ctors.length > 0 ? ctors : [cls];
    });
    return { outcome: 'callsResolved', targets };
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
    const aliased = this.aliasedCall(fileId, local, [...rest, method], ctx, depth);
    if (aliased) return aliased;
    // `new db.user()` / `const User = db.user; new User()`: chama (ou constrói) o próprio valor do módulo
    const direct = this.moduleInfo.get(fileId)?.objectRequires.get([local, ...rest, method].join('.'));
    const directTarget = direct !== undefined ? this.specTargets.get(fileId)?.get(direct) : undefined;
    if (directTarget?.kind === 'package') return this.external(directTarget.name);
    if (directTarget?.kind === 'file') {
      const ids = this.resolveExport(directTarget.id, 'default');
      if (ids.length > 0) return this.found(ids);
      const loc = this.resolveExportLocal(directTarget.id, 'default', new Set());
      return (loc && this.externalValue(loc.file, loc.local, ctx, depth)) ?? UNRESOLVED;
    }
    // `db.user.findOne()` com `db.user = require('./user.model')` neste arquivo: segue para o módulo
    for (let i = rest.length; i >= 1; i--) {
      const spec = this.moduleInfo.get(fileId)?.objectRequires.get([local, ...rest.slice(0, i)].join('.'));
      const target = spec !== undefined ? this.specTargets.get(fileId)?.get(spec) : undefined;
      if (target?.kind === 'file') return this.memberOfModule(target.id, rest.slice(i), method, ctx, true);
      if (target?.kind === 'package') return this.external(target.name);
    }
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
    if (type) return this.resolveMember(fileId, type, rest, method, ctx);
    // valor que sai de uma chamada (`const app = express()`, `module.exports = mongoose.model(...)`):
    // o membro é do que a chamada devolve. A pilha corta o laço entre dois arquivos que se exportam assim.
    const produced = this.moduleInfo.get(fileId)?.valueCalls.get(local);
    const key = `${fileId}|${local}`;
    if (!produced || this.valueCallStack.has(key)) return undefined;
    const statics = this.modelMember(fileId, produced, 'statics', rest, method);
    if (statics) return statics;
    this.valueCallStack.add(key);
    try {
      return this.resolveReturnMember(fileId, produced, rest, method, ctx, depth + 1);
    } finally {
      this.valueCallStack.delete(key);
    }
  }

  /**
   * `m` no módulo `fileId` visto como um valor só: `import * as ns` / `const ns = require()` (`rest` são
   * as propriedades entre o módulo e o método). Num `require`, um arquivo com `module.exports = app`
   * devolve o próprio `app`: o que não for export com nome é membro dele.
   */
  private memberOfModule(fileId: string, rest: string[], method: string, ctx: ResolutionContext, cjs: boolean): CallResolution {
    const named =
      rest.length === 0 ? this.found(this.resolveExport(fileId, method)) : this.resolveMemberOfExport(fileId, rest[0]!, rest.slice(1), method, ctx);
    if (cjs && named.outcome !== 'callsResolved' && named.outcome !== 'callsExternal' && this.moduleInfo.get(fileId)?.exports.has('default')) {
      return this.resolveMemberOfExport(fileId, 'default', rest, method, ctx);
    }
    return named;
  }

  /** `x.m()` com `x` importado de `fileId` (seguindo barrels até onde `x` é declarado). */
  private resolveMemberOfExport(fileId: string, exported: string, rest: string[], method: string, ctx: ResolutionContext): CallResolution {
    // `export * as svc from './svc'` / `module.exports.svc = require('./svc')`: `x` é o módulo inteiro
    const ns = this.moduleInfo.get(fileId)?.reexports.find((re) => re.exported === exported && re.imported === '*');
    const nsTarget = ns && this.specTargets.get(fileId)?.get(ns.spec);
    if (nsTarget?.kind === 'file') return this.memberOfModule(nsTarget.id, rest, method, ctx, !!ns!.require);
    if (nsTarget?.kind === 'package') return this.external(nsTarget.name);
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
      if (re.exported !== exported) continue;
      const from = targetOf(re.spec);
      // `module.exports.User = require('./user.model')` com `module.exports = User` lá: é o próprio valor
      if (re.imported === '*') {
        if (re.require && from && this.moduleInfo.get(from)?.exports.has('default')) return this.resolveExportLocal(from, 'default', seen);
        continue;
      }
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

  /** C#/Java: nomes das classes que o arquivo declara (o índice de tipos é por nome). */
  private classNames(fileId: string): Set<string> {
    const names = new Set<string>();
    if (!this.scopes.has(fileId)) return names;
    for (const id of this.ownedSymbols(fileId)) {
      const attrs = this.graph.getNodeAttributes(id);
      if (attrs.kind === 'class') names.add(attrs.name);
      else if (attrs.kind === 'method' && attrs.extensionOf) names.add(`${EXTENSION_KEY}${attrs.name}`);
      if (attrs.kind === 'class') for (const m of attrs.handles ?? []) names.add(`${MESSAGE_KEY}${m.slice(m.lastIndexOf('.') + 1)}`);
    }
    return names;
  }

  /** Religa quem resolveu algum destes nomes pelo índice de tipos — ou, com `all`, todo arquivo C#/Java. */
  private relinkTypeDependents(names: Set<string>, changedFile: string, all = false): void {
    const files = new Set<string>(all ? this.scopes.keys() : []);
    for (const name of names) for (const f of this.typeDependents.get(name) ?? []) files.add(f);
    for (const f of files) if (f !== changedFile && this.graph.hasNode(f)) this.relinkCalls(f);
  }

  private relinkInterfaceDependents(interfaces: Set<string>, changedFile: string): void {
    const files = new Set<string>();
    for (const name of interfaces) for (const f of this.interfaceDependents.get(name) ?? []) files.add(f);
    for (const f of files) if (f !== changedFile && this.graph.hasNode(f)) this.relinkCalls(f);
  }

  private declaresTopLevel(fileId: string, name: string): boolean {
    const info = this.moduleInfo.get(fileId);
    return this.topLevelByName(fileId, name).length > 0 || this.hasContainer(fileId, name) || !!info?.valueTypes.has(name) || !!info?.valueCalls.has(name);
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

  /**
   * O arquivo repassa algo que depende de outro arquivo? `export * from`, `export { x } from`,
   * `export { importado }`, e também uma instância exportada (`export const svc = new Svc()`, com
   * `Svc` vindo de outro arquivo) ou um objeto exportado que aponta para nomes (`export default
   * { createApp }`): quem importa a instância resolve `svc.m()` pela classe, então tem que religar
   * quando a classe chega. Sem isso, o mapa dependia da ordem de indexação.
   */
  private forwardsImports(fileId: string): boolean {
    const info = this.moduleInfo.get(fileId);
    if (!info) return false;
    // `db.user = require('./user.model')`: o objeto repassa outro módulo, como um barrel
    if (info.reexports.length > 0 || info.objectRequires.size > 0) return true;
    const imported = new Set(info.imports.map((b) => b.local));
    const exported = new Set(info.exports.values());
    if ([...exported].some((local) => imported.has(local) || info.valueTypes.has(local) || info.valueCalls.has(local))) return true;
    return [...info.objectRefs.keys()].some((path) => exported.has(path.split('.', 1)[0]!));
  }

  private importTargets(fileId: string): string[] {
    return this.graph
      .outEdges(fileId)
      .filter((e) => this.graph.getEdgeAttribute(e, 'type') === 'imports')
      .map((e) => this.graph.target(e))
      .filter((t) => !this.isPackage(t));
  }
}
