// Mutantes para os pares do DPO (D4, decisão 0016): a partir de código que aguenta a falha, uma
// mutação por mutante, que tira a proteção. A troca é por faixa de nós do Tree-sitter, nunca
// regex; o SQL das chamadas `query('BEGIN')` é lido pelo analisador léxico. Um mutante só vira par
// se o original aguentou e o mutante deu achado no mesmo teste, com o controle verde nos dois.

import { tokenizeSql, type SyntaxNode, type TsParser } from '@shieldepy/core';

export type MutationOperator = 'sem-timeout' | 'sem-transacao' | 'cobra-antes-de-reservar' | 'sem-estorno';

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface Mutation {
  operator: MutationOperator;
  /** Relativo ao projeto, com `/`. */
  file: string;
  /** 1-based: onde a mutação começa. */
  line: number;
  description: string;
  edits: TextEdit[];
}

/** Nomes que o motor lê como cada passo (por nome do método, no nó da chamada). */
const RESERVE = new Set(['reserve', 'reservar', 'decrement', 'baixar']);
const CHARGE = new Set(['charge', 'cobrar', 'pay', 'pagar']);
const REFUND = new Set(['refund', 'estornar', 'reembolsar']);
const TX = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'START']);
const FUNCTIONS = new Set(['function_declaration', 'function_expression', 'arrow_function', 'method_definition', 'generator_function_declaration']);

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const c of node.namedChildren) walk(c, visit);
}

/** `fetch(...)` → `fetch`; `this.payments.charge(...)` → `charge`. */
function calleeName(call: SyntaxNode): { name: string; object?: string } | undefined {
  const fn = call.childForFieldName('function');
  if (!fn) return undefined;
  if (fn.type === 'identifier') return { name: fn.text };
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property');
    const obj = fn.childForFieldName('object');
    return prop ? { name: prop.text, object: obj?.text } : undefined;
  }
  return undefined;
}

const calls = (node: SyntaxNode, names: Set<string>) => {
  const out: SyntaxNode[] = [];
  walk(node, (n) => {
    if (n.type === 'call_expression' && names.has(calleeName(n)?.name ?? '')) out.push(n);
  });
  return out;
};

/** Apaga a faixa; se ela ocupa a linha sozinha (só espaço antes e depois), a linha inteira sai. */
function removal(text: string, start: number, end: number): TextEdit {
  let s = start;
  while (s > 0 && (text[s - 1] === ' ' || text[s - 1] === '\t')) s--;
  let e = end;
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
  const wholeLine = (s === 0 || text[s - 1] === '\n') && (e === text.length || text[e] === '\n' || text[e] === '\r');
  if (!wholeLine) return { start, end, text: '' };
  if (text[e] === '\r') e++;
  if (text[e] === '\n') e++;
  return { start: s, end: e, text: '' };
}

const lineOf = (text: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
};

/** Tira o `signal`/`timeout` das opções de um `fetch` ou de uma chamada do `axios`. */
function withoutTimeout(root: SyntaxNode, text: string): Omit<Mutation, 'file'>[] {
  const out: Omit<Mutation, 'file'>[] = [];
  walk(root, (call) => {
    if (call.type !== 'call_expression') return;
    const callee = calleeName(call);
    const isFetch = callee?.name === 'fetch' && !callee.object;
    const isAxios = callee?.name === 'axios' || callee?.object === 'axios';
    if (!isFetch && !isAxios) return;
    for (const arg of call.childForFieldName('arguments')?.namedChildren ?? []) {
      if (arg.type !== 'object') continue;
      for (const pair of arg.namedChildren) {
        const key = pair.type === 'pair' ? pair.childForFieldName('key')?.text : undefined;
        if (key !== 'signal' && key !== 'timeout') continue;
        const comma = pair.nextSibling?.type === ',' ? pair.nextSibling : undefined;
        out.push({
          operator: 'sem-timeout',
          line: lineOf(text, pair.startIndex),
          description: `tira o ${key} de ${isFetch ? 'fetch' : 'axios'}`,
          edits: [removal(text, pair.startIndex, comma ? comma.endIndex : pair.endIndex)],
        });
      }
    }
  });
  return out;
}

/** Tira o estorno do `catch`: a chamada de `refund` (com o `.then`/`await` em volta) vira `false` ou sai. */
function withoutRefund(root: SyntaxNode, text: string): Omit<Mutation, 'file'>[] {
  const out: Omit<Mutation, 'file'>[] = [];
  walk(root, (clause) => {
    if (clause.type !== 'catch_clause') return;
    for (const call of calls(clause, REFUND)) {
      let expr = call;
      while (expr.parent && ['member_expression', 'call_expression', 'await_expression', 'parenthesized_expression'].includes(expr.parent.type)) expr = expr.parent;
      const holder = expr.parent;
      if (holder?.type === 'variable_declarator' && holder.childForFieldName('value')?.startIndex === expr.startIndex) {
        out.push({ operator: 'sem-estorno', line: lineOf(text, expr.startIndex), description: 'o estorno do catch vira false', edits: [{ start: expr.startIndex, end: expr.endIndex, text: 'false' }] });
      } else if (holder?.type === 'expression_statement') {
        out.push({ operator: 'sem-estorno', line: lineOf(text, holder.startIndex), description: 'tira o estorno do catch', edits: [removal(text, holder.startIndex, holder.endIndex)] });
      }
    }
  });
  return out;
}

/** Inverte "reserva → cobrança": a reserva (e os `if` que a guardam) passa para depois da cobrança. */
function chargeBeforeReserve(root: SyntaxNode, text: string): Omit<Mutation, 'file'>[] {
  const out: Omit<Mutation, 'file'>[] = [];
  walk(root, (block) => {
    if (block.type !== 'statement_block') return;
    const stmts = block.namedChildren.filter((s) => s.type !== 'comment');
    const reserve = stmts.findIndex((s) => calls(s, RESERVE).length > 0);
    if (reserve < 0) return;
    const pay = stmts.findIndex((s, i) => i > reserve && calls(s, CHARGE).length > 0);
    if (pay < 0) return;
    let end = reserve;
    while (end + 1 < pay && stmts[end + 1]!.type === 'if_statement') end++;
    const first = stmts[reserve]!;
    let lineStart = first.startIndex;
    while (lineStart > 0 && (text[lineStart - 1] === ' ' || text[lineStart - 1] === '\t')) lineStart--;
    const sep = (text.includes('\r\n') ? '\r\n' : '\n') + text.slice(lineStart, first.startIndex);
    const slice = (from: number, to: number) => stmts.slice(from, to + 1).map((s) => text.slice(s.startIndex, s.endIndex));
    out.push({
      operator: 'cobra-antes-de-reservar',
      line: lineOf(text, first.startIndex),
      description: 'cobra antes de reservar o estoque',
      edits: [{ start: first.startIndex, end: stmts[pay]!.endIndex, text: [...slice(end + 1, pay), ...slice(reserve, end)].join(sep) }],
    });
  });
  return out;
}

/** O SQL de `query('BEGIN')`: só um identificador de transação, lido pelo léxico (comentário e string não contam). */
function txKeyword(call: SyntaxNode): string | undefined {
  const arg = call.childForFieldName('arguments')?.namedChildren[0];
  if (!arg || (arg.type !== 'string' && arg.type !== 'template_string') || arg.namedChildren.some((c) => c.type === 'template_substitution')) return undefined;
  const tokens = tokenizeSql(arg.text.slice(1, -1));
  const word = tokens.length === 1 && tokens[0]!.kind === 'ident' ? tokens[0]!.value.toUpperCase() : undefined;
  return word && TX.has(word) ? word : undefined;
}

/** Tira o BEGIN/COMMIT/ROLLBACK de uma função (todos juntos: só o BEGIN deixaria a conexão presa). */
function withoutTransaction(root: SyntaxNode, text: string): Omit<Mutation, 'file'>[] {
  const byFunction = new Map<number, { fn: SyntaxNode; stmts: SyntaxNode[]; words: Set<string> }>();
  walk(root, (call) => {
    if (call.type !== 'call_expression' || calleeName(call)?.name !== 'query') return;
    const word = txKeyword(call);
    if (!word) return;
    let expr = call;
    while (expr.parent?.type === 'await_expression') expr = expr.parent;
    const stmt = expr.parent?.type === 'expression_statement' ? expr.parent : undefined;
    if (!stmt) return;
    let fn = stmt.parent;
    while (fn && !FUNCTIONS.has(fn.type)) fn = fn.parent;
    if (!fn) return;
    const group = byFunction.get(fn.startIndex) ?? { fn, stmts: [], words: new Set() };
    group.stmts.push(stmt);
    group.words.add(word);
    byFunction.set(fn.startIndex, group);
  });
  return [...byFunction.values()]
    .filter((g) => g.words.has('BEGIN') || g.words.has('START'))
    .map((g) => ({
      operator: 'sem-transacao' as const,
      line: lineOf(text, g.stmts[0]!.startIndex),
      description: `tira ${[...g.words].sort().join('/')} da função`,
      edits: g.stmts.map((s) => removal(text, s.startIndex, s.endIndex)),
    }));
}

/** As mutações possíveis num arquivo, em ordem de linha. Cada uma é um mutante. */
export function findMutations(parser: Pick<TsParser, 'withTree'>, file: string, text: string, jsx = false): Mutation[] {
  return parser
    .withTree(text, jsx, (root) => [...withoutTimeout(root, text), ...withoutTransaction(root, text), ...chargeBeforeReserve(root, text), ...withoutRefund(root, text)])
    .map((m) => ({ ...m, file }))
    .sort((a, b) => a.line - b.line || (a.operator < b.operator ? -1 : a.operator > b.operator ? 1 : 0));
}

export function applyEdits(text: string, edits: TextEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** `mutante:sem-timeout@src/gateways/StripeGateway.ts:17`: o operador e onde (um arquivo pode ter dois sítios). */
export const mutantVariant = (m: Pick<Mutation, 'operator' | 'file' | 'line'>) => `mutante:${m.operator}@${m.file}:${m.line}` as const;
