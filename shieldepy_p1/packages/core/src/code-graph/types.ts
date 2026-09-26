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

export type NodeAttrs = FileNodeAttrs | SymbolNodeAttrs;

export type EdgeType = 'defines' | 'imports' | 'calls';

export interface EdgeAttrs {
  type: EdgeType;
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
  return attrs.kind !== 'file';
}
