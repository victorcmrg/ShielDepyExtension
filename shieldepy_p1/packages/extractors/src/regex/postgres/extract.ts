// Extrai o que uma função de trigger LÊ e ESCREVE.
//
// No Postgres, o que o trigger mexe está ESCONDIDO no corpo da função (PL/pgSQL).
// Convenção da linguagem:
//   - escrever  =>  atribuição a NEW:   NEW.total := ...
//   - ler       =>  qualquer NEW.col / OLD.col que NÃO seja o lado esquerdo de :=
//
// MVP honesto: leitura de texto (regex). NÃO cobre SQL dinâmico (EXECUTE), nem colunas
// mexidas dentro de outras funções chamadas. Suficiente para triggers diretos.

import { stripSqlComments } from '../text';

export interface FieldAccess {
  reads: string[];
  writes: string[];
}

/** Lado esquerdo de uma atribuição a NEW: `NEW.col :=` (aceita aspas: NEW."col"). */
// Só `:=` — em PL/pgSQL `=` também é comparação (`IF NEW.x = OLD.x`), não dá pra tratar como escrita.
const WRITE_RE = /\bNEW\s*\.\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*:=/gi;
/** Qualquer referência a coluna via NEW. ou OLD. */
const REF_RE = /\b(?:NEW|OLD)\s*\.\s*"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;

export function extractFieldAccess(source: string): FieldAccess {
  const body = stripSqlComments(source);

  const writes = new Set<string>();
  for (const m of body.matchAll(WRITE_RE)) writes.add(m[1]!);

  // Remove os tokens do lado esquerdo (`NEW.col :=`) para não contá-los como leitura —
  // o lado direito continua (NEW.total := NEW.total + 1 ainda conta 'total' como leitura).
  const bodyNoLhs = body.replace(WRITE_RE, ' ');

  const reads = new Set<string>();
  for (const m of bodyNoLhs.matchAll(REF_RE)) reads.add(m[1]!);

  return { reads: [...reads].sort(), writes: [...writes].sort() };
}
