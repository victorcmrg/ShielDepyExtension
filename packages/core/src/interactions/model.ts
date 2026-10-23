// O "idioma padrão" (IR — Intermediate Representation) do Grafo de Interações.
// Todo extrator produz `Rule[]`; o motor SÓ entende este formato e nada mais.
// interactions/ nunca importa de extractors/ — dependência de mão única.

/** Onde a regra foi declarada — usado pra apontar o Diagnostic na linha certa. */
export interface SourceLocation {
  /** Caminho do arquivo (mesmo formato de `toFileId`). */
  file: string;
  /** Linha 0-based do início da regra. */
  line: number;
}

/** Uma regra reativa normalizada (trigger de banco, handler de evento, etc.) traduzida de algum sistema. */
export interface Rule {
  /** Identificador estável, único dentro do conjunto de regras. */
  id: string;
  /** Nome legível (ex.: "trg_apply_discount"). */
  name: string;
  /** A "coisa" que reage. Postgres: a tabela. */
  resource: string;
  /** O que dispara a regra. Postgres: "before update", "after insert", etc. */
  event: string;
  /** Campos/colunas que a regra LÊ. */
  reads: string[];
  /** Campos/colunas que a regra ESCREVE. */
  writes: string[];
  /**
   * Ordem de execução dentro do mesmo recurso+evento (menor roda primeiro).
   * Fornecida pelo extrator. Postgres: derivada do nome do trigger (ordem alfabética).
   * `undefined` => ordem desconhecida; read-after-write vira "ordem indefinida".
   */
  order?: number;
  /** Texto opaco da guarda/condição. NÃO é avaliado no MVP. */
  condition?: string;
  /** Qual extrator/domínio gerou esta regra. */
  source: string;
  /** Onde a regra está no código, quando o extrator sabe. */
  location?: SourceLocation;
}

/** Chave de agrupamento do grafo: recurso × evento. */
export interface ResourceEventKey {
  resource: string;
  event: string;
}

/** O "Grafo de Interações": regras agrupadas por recurso+evento ("quem reage ao quê"). */
export interface InteractionGraph {
  /** chave `${resource}::${event}` -> regras do balde (ordenadas por `order`). */
  buckets: Map<string, Rule[]>;
}

export type Collision = WriteWriteCollision | ReadAfterWriteCollision;

/** Duas regras escrevem o mesmo campo no mesmo recurso+evento. */
export interface WriteWriteCollision {
  type: 'write-write';
  resource: string;
  event: string;
  field: string;
  /** ids das duas regras, ordenados deterministicamente. */
  rules: [string, string];
}

/** Uma regra lê um campo que a outra escreve no mesmo recurso+evento (dependência de ordem). */
export interface ReadAfterWriteCollision {
  type: 'read-after-write';
  resource: string;
  event: string;
  field: string;
  /** id da regra que LÊ. */
  reader: string;
  /** id da regra que ESCREVE. */
  writer: string;
  /**
   * reader-first  = leitor roda ANTES -> lê valor DESATUALIZADO (o bug clássico).
   * writer-first  = leitor roda DEPOIS -> lê o valor já alterado.
   * unknown       = uma das regras não tem `order` -> resultado imprevisível.
   */
  ordering: 'reader-first' | 'writer-first' | 'unknown';
}

/** Ids das duas regras envolvidas numa colisão, independente do tipo. */
export function collisionRuleIds(c: Collision): [string, string] {
  return c.type === 'write-write' ? c.rules : [c.reader, c.writer];
}

/** Identidade de uma colisão — igual para o mesmo fato, mesmo recalculado (ex.: comparar antes/depois de um fix). */
export function collisionKey(c: Collision): string {
  const ids = c.type === 'write-write' ? [...c.rules].sort().join('+') : `${c.reader}<${c.writer}`;
  return `${c.type}|${c.resource}|${c.event}|${c.field}|${ids}`;
}
