// Extrai o que uma função de trigger LÊ e ESCREVE, sobre os tokens do PL/pgSQL.
//
// No Postgres, o que o trigger mexe está no corpo da função. Convenção da linguagem:
//   - escrever  =>  atribuição a NEW: `NEW.total := ...` ou `NEW.total = ...` NO INÍCIO de um
//                   comando (em PL/pgSQL `=` também atribui; no meio de uma expressão, compara)
//   - ler       =>  qualquer outro NEW.col / OLD.col
//
// Limite honesto: SQL dinâmico (`EXECUTE '...'`) é string e não é seguido, nem colunas mexidas
// dentro de outras funções chamadas.

import { FieldAccess } from '../naming';
import { tokenizeSql as tokenize, type SqlToken as Token } from '@shieldepy/core';

export interface FieldAccessResult {
  reads: string[];
  writes: string[];
}

/** Palavras depois das quais começa um novo comando. */
const STATEMENT_STARTERS = new Set(['BEGIN', 'THEN', 'ELSE', 'LOOP', 'DECLARE']);

const isWord = (t: Token | undefined, word: string) => t?.kind === 'ident' && !t.quoted && t.value.toUpperCase() === word;
const isOp = (t: Token | undefined, op: string) => t?.kind === 'op' && t.value === op;

function statementStart(prev: Token | undefined): boolean {
  if (!prev) return true;
  if (isOp(prev, ';')) return true;
  return prev.kind === 'ident' && !prev.quoted && STATEMENT_STARTERS.has(prev.value.toUpperCase());
}

export function extractFieldAccess(source: string): FieldAccessResult {
  const tokens = tokenize(source);
  const access = new FieldAccess();

  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i];
    const isNew = isWord(record, 'NEW');
    if (!isNew && !isWord(record, 'OLD')) continue;
    if (!isOp(tokens[i + 1], '.')) continue;
    const field = tokens[i + 2];
    if (field?.kind !== 'ident') continue;

    // identificador sem aspas é dobrado pra minúscula pelo Postgres (`NEW.Total` é a coluna `total`)
    const column = field.quoted ? field.value : field.value.toLowerCase();
    const after = tokens[i + 3];
    const assigns = isNew && (isOp(after, ':=') || (isOp(after, '=') && statementStart(tokens[i - 1])));
    if (assigns) access.write(column);
    else access.read(column);
    i += 2;
  }
  return access.result();
}
