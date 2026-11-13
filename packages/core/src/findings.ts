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
export type FindingSource = 'grafo' | 'colisao' | 'ia' | 'caos';

export interface RelatedLocation {
  file: string;
  line: number;
  message: string;
}

/** O que um teste de caos provou: o balão do editor mostra isto em vez do texto corrido. */
export interface FindingChaos {
  /** "Falha parcial em orders" */
  headline: string;
  /** "a API foi chamada, a gravação falhou e nada foi desfeito" */
  explain: string;
  severity?: string;
  route: string;
  failure: string;
  target: string;
  /** a invariante que quebrou, como o teste registrou ("stateCheck: noChargeWithoutOrder") */
  invariant?: string;
  /** caminho absoluto do teste que prova a falha */
  test: string;
  durationMs: number;
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
  /** Quando saiu o resultado salvo de onde o achado veio (ms desde 1970): ele reaparece ao abrir o projeto. */
  ranAt?: number;
  /** Só nos achados do caos: os dados do teste que provou a falha. */
  chaos?: FindingChaos;
}
