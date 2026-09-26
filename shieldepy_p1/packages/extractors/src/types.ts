// Formato intermediário que TODO extrator de linguagem produz, antes de virar `Rule`.
export interface ParsedRule {
  /** evento de domínio (ex.: "order.updated", "OrderUpdated", "pre_save"). */
  event: string;
  /** recurso afetado (ex.: "order", "Order"). */
  resource: string;
  reads: string[];
  writes: string[];
  /** Linha 0-based onde a regra é declarada, quando o extrator sabe. */
  line?: number;
}

/** Uma regra já associada ao serviço/módulo (e arquivo) de onde veio. */
export interface ServiceRule extends ParsedRule {
  service: string;
  /** Id do arquivo (`toFileId`), quando a regra veio de um arquivo em disco. */
  file?: string;
}

/** Assinatura de um extrator de linguagem: recebe o texto de um arquivo, devolve as regras. */
export type Parse = (source: string) => ParsedRule[];
