export type SymbolKind = 'function' | 'class' | 'method' | 'selector';

export interface HtmlUsage {
  /** `.classe` ou `#id` */
  token: string;
  line: number;
}

export interface FileNodeAttrs {
  kind: 'file';
  /** Caminho em disco (formato nativo do SO). */
  path: string;
  /** Placeholder criado por um import antes de o arquivo alvo ser parseado. */
  external?: boolean;
  htmlUsages?: HtmlUsage[];
}

export interface SymbolNodeAttrs {
  kind: SymbolKind;
  name: string;
  /** Id do arquivo dono. */
  file: string;
  startLine: number;
  endLine: number;
  /** Lista de parâmetros (texto literal, ex: "(a: string, b: number)") — grátis, vem do próprio parse. */
  signature?: string;
  /** Método: classe ou objeto literal que o contém. */
  container?: string;
  /** Classe: tipo base (`extends`), interfaces (`implements`) e tipo de cada campo conhecido. */
  extends?: string[];
  implements?: string[];
  fields?: Record<string, string[]>;
  properties?: string[];
  /** Função/método: tipo de retorno anotado (`Promise<T>` → T); `[]` = anotado, mas não é classe. */
  returns?: string[];
}

/** Dependência externa (`pg`, `@prisma/client`, `node:fs`) — id `pkg:<nome>`. */
export interface PackageNodeAttrs {
  kind: 'package';
  name: string;
}

export type NodeAttrs = FileNodeAttrs | SymbolNodeAttrs | PackageNodeAttrs;

/** `references`: função passada como valor (`app.post('/x', handler)`) — não é chamada, mas será executada. */
export type EdgeType = 'defines' | 'imports' | 'calls' | 'references';

export interface EdgeAttrs {
  type: EdgeType;
  /**
   * `calls` ligada só por coincidência de nome (receptor desconhecido, ex: `obj.save()` sem saber
   * o tipo de `obj`). Ausente = ligação provada pela tabela de imports/exports.
   */
  heuristic?: boolean;
}

/** Qualidade do mapa: quanto das chamadas para código do PROJETO foi resolvido. */
export interface CallCoverage {
  /** Ligadas por import/export/escopo — sem adivinhação. */
  callsResolved: number;
  /** Ligadas só por nome (fallback). */
  callsHeuristic: number;
  /** Apontam pra uma ligação do projeto, mas o alvo não foi achado (export inexistente, import quebrado). */
  callsUnresolved: number;
  /** Chamadas para pacotes externos (`pg`, `axios`...). */
  callsExternal: number;
  /** Especificadores de import do projeto que não resolvem pra arquivo nenhum. */
  importsUnresolved: number;
}

export interface GraphStats extends CallCoverage {
  nodes: number;
  edges: number;
}

export interface GraphSnapshot {
  nodes: Array<{ id: string; attributes: NodeAttrs }>;
  edges: Array<{ source: string; target: string; attributes: EdgeAttrs }>;
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
  kind: SymbolKind;
  signature?: string;
}

/** Um símbolo do arquivo que participa de um ciclo dirigido. */
export interface SymbolCycle {
  symbolId: string;
  name: string;
  startLine: number;
  endLine: number;
  /** Ids da cadeia, começando e terminando no símbolo. */
  path: string[];
  /** Rótulos legíveis da cadeia (ex: ["login", "refreshToken", "login"]). */
  labels: string[];
}

/**
 * Como uma chamada foi resolvida: `resolved` (provada), `heuristic` (só por nome), `unresolved`
 * (devia ser do projeto, alvo não achado), `external` (pacote), `unbound` (nativo/global/variável).
 */
export type CallOutcome = 'resolved' | 'heuristic' | 'unresolved' | 'external' | 'unbound';

/** Onde um nome é declarado: no topo de um arquivo (seguindo imports e barrels) ou dentro do chamador (`local`). */
export interface ValueOrigin {
  file: string;
  name: string;
  local?: boolean;
}

/** Argumento de uma chamada, só no que é estático (lido da AST, nunca avaliado). */
export type CallArg =
  | { kind: 'string'; value: string }
  /** `\`https://api.x.com/${id}\`` → o texto literal antes da 1ª substituição. */
  | { kind: 'template'; prefix: string }
  /** `{ method: 'POST', signal }` → as chaves; `...spread` vira `'...'`. */
  | { kind: 'object'; keys: string[] }
  /** Callback inline; `symbolId` quando ele virou símbolo. */
  | { kind: 'function'; symbolId?: string }
  /** Identificador ou cadeia (`router`, `ctrl.create`), resolvido como referência. */
  | { kind: 'name'; chain: string[]; outcome: CallOutcome; targets: string[]; package?: string; origin?: ValueOrigin }
  | { kind: 'other' };

/** Uma chamada do código, já resolvida, com a posição e os argumentos. */
export interface CallSite {
  /** Símbolo que contém a chamada, ou o próprio arquivo quando ela está no topo dele. */
  caller: string;
  /** Início da chamada, 0-based (como `startLine`). */
  line: number;
  column: number;
  name: string;
  object?: string[];
  outcome: CallOutcome;
  /** Símbolos do projeto (em `resolved`/`heuristic`). */
  targets: string[];
  /** Pacote, em `external` (`pg`, `express`). */
  package?: string;
  /** O nome chamado (ou a raiz do receptor) é variável local — `fetch` local não é o global. */
  shadowed?: boolean;
  /** Onde a raiz do receptor é declarada (`checkoutRouter` em `checkoutRouter.post`). */
  receiverOrigin?: ValueOrigin;
  args: CallArg[];
}

export function isSymbolNode(attrs: NodeAttrs): attrs is SymbolNodeAttrs {
  return attrs.kind !== 'file' && attrs.kind !== 'package';
}

export function packageNodeId(name: string): string {
  return `pkg:${name}`;
}
