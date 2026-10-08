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
}

/** Dependência externa (`pg`, `@prisma/client`, `node:fs`) — id `pkg:<nome>`. */
export interface PackageNodeAttrs {
  kind: 'package';
  name: string;
}

export type NodeAttrs = FileNodeAttrs | SymbolNodeAttrs | PackageNodeAttrs;

export type EdgeType = 'defines' | 'imports' | 'calls';

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

export function isSymbolNode(attrs: NodeAttrs): attrs is SymbolNodeAttrs {
  return attrs.kind !== 'file' && attrs.kind !== 'package';
}

export function packageNodeId(name: string): string {
  return `pkg:${name}`;
}
