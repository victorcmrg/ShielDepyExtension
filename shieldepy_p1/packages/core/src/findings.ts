/**
 * Achado unificado — o que qualquer interface (extensão, CLI, web) mostra. Sem `vscode.Range`:
 * linhas 0-based, a extensão converte na hora de publicar o Diagnostic.
 */
export type FindingSeverity = 'error' | 'warning' | 'info';

/**
 * De onde veio o achado — e, com isso, quanto ele vale como prova:
 * - `grafo`   : estrutural, determinístico (ciclo, referência HTML→CSS quebrada)
 * - `colisao` : provado pelo motor de colisões (duas regras brigam por um campo)
 * - `ia`      : opinião do modelo; nunca tem a mesma força de prova dos outros dois
 */
export type FindingSource = 'grafo' | 'colisao' | 'ia';

export interface RelatedLocation {
  file: string;
  line: number;
  message: string;
}

export interface Finding {
  file: string;
  startLine: number;
  endLine: number;
  severity: FindingSeverity;
  message: string;
  impact?: string;
  source: FindingSource;
  /** Outros pontos do código envolvidos (ex: a outra regra da colisão). */
  related?: RelatedLocation[];
  /** 0–100. Achados determinísticos são 100; os de IA trazem o que o modelo declarou. */
  confidence?: number;
  /**
   * Identidade estável do achado (vira o #id citável no chat). Sem ela, usa-se a mensagem —
   * o que muda toda vez que a IA reescreve a frase. Ex.: o símbolo do ciclo, a chave da colisão.
   */
  key?: string;
}
