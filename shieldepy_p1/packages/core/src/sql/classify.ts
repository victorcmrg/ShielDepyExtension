// O que um comando SQL faz, lido dos tokens (nunca por regex): verbo, tabelas e trava de linha.
// É o que transforma `pool.query('UPDATE stock ...')` numa operação `db_write stock`.

import { tokenize, type Token } from './lexer';

export type SqlKind = 'read' | 'write' | 'tx' | 'unknown';

export interface SqlSummary {
  kind: SqlKind;
  /** Verbo principal em maiúsculas (`SELECT`, `INSERT`, `BEGIN`...), ou ausente se não reconhecido. */
  verb?: string;
  /** Tabela principal: a escrita (INSERT/UPDATE/DELETE) ou a 1ª lida (SELECT). */
  table?: string;
  /** Todas as tabelas citadas (FROM, JOIN, INTO, UPDATE), sem as CTEs. */
  tables: string[];
  /** `SELECT ... FOR UPDATE / FOR SHARE`. */
  lock?: true;
}

const MAIN_VERBS: Record<string, SqlKind> = { SELECT: 'read', INSERT: 'write', UPDATE: 'write', DELETE: 'write', MERGE: 'write' };
const TX_VERBS = new Set(['BEGIN', 'START', 'COMMIT', 'ROLLBACK', 'END', 'SAVEPOINT', 'RELEASE']);
const TABLE_AFTER = new Set(['FROM', 'JOIN', 'INTO', 'UPDATE']);

const kw = (t: Token | undefined): string | undefined => (t?.kind === 'ident' && !t.quoted ? t.value.toUpperCase() : undefined);
const isOp = (t: Token | undefined, value: string) => t?.kind === 'op' && t.value === value;

/** Nome como o Postgres o enxerga: sem aspas vira minúsculo; `schema.tabela` fica junto. */
function nameAt(tokens: Token[], i: number): { name: string; next: number } | undefined {
  const parts: string[] = [];
  let j = i;
  for (;;) {
    const t = tokens[j];
    if (t?.kind !== 'ident') return undefined;
    parts.push(t.quoted ? t.value : t.value.toLowerCase());
    if (!isOp(tokens[j + 1], '.')) return { name: parts.join('.'), next: j + 1 };
    j += 2;
  }
}

export function classifySql(sql: string): SqlSummary {
  const tokens = tokenize(sql, false);
  const first = kw(tokens[0]);
  if (first && TX_VERBS.has(first)) return { kind: 'tx', verb: first, tables: [] };

  // CTEs: `WITH x AS (...)` — `x` é nome local, não tabela
  const ctes = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (kw(tokens[i + 1]) === 'AS' && isOp(tokens[i + 2], '(') && tokens[i]!.kind === 'ident') {
      ctes.add(nameAt(tokens, i)!.name);
    }
  }

  let verb: string | undefined;
  let depth = 0;
  let lock = false;
  const tables: string[] = [];
  let written: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isOp(t, '(')) depth++;
    else if (isOp(t, ')')) depth--;
    const word = kw(t);
    if (!word) continue;
    // o verbo principal é o 1º no nível de fora (o de dentro de uma CTE ou subconsulta não conta)
    if (!verb && depth === 0 && MAIN_VERBS[word]) verb = word;
    if (word === 'FOR' && (kw(tokens[i + 1]) === 'UPDATE' || kw(tokens[i + 1]) === 'SHARE' || kw(tokens[i + 1]) === 'NO')) {
      lock = true;
      i++;
      continue;
    }
    if (!TABLE_AFTER.has(word)) continue;
    // `DELETE FROM t` / `UPDATE ONLY t`
    let k = i + 1;
    if (kw(tokens[k]) === 'ONLY') k++;
    const named = nameAt(tokens, k);
    if (!named || ctes.has(named.name)) continue;
    if (!tables.includes(named.name)) tables.push(named.name);
    if (depth === 0 && !written && (word === 'INTO' || word === 'UPDATE' || (word === 'FROM' && verb === 'DELETE'))) written = named.name;
  }

  const kind = verb ? MAIN_VERBS[verb]! : 'unknown';
  const table = kind === 'write' ? written ?? tables[0] : tables[0];
  return { kind, ...(verb && { verb }), ...(table && { table }), tables, ...(lock && { lock: true as const }) };
}
