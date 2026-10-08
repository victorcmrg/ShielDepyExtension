// Leitura da árvore Tree-sitter de um arquivo TS/JS: símbolos, imports e chamadas.
// Funções puras — não sabem nada do grafo; o CodeGraph decide o que fazer com o resultado.

import type { SyntaxNode } from './parser';
import { DEFAULT_EXPORT_NAME } from './extract-module';
import type { SymbolKind } from './types';

export interface SymbolInfo {
  id: string;
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  /** Lista de parâmetros (texto literal, ex: "(a: string, b: number)"). */
  signature?: string;
  /** Offsets de caractere — atribuir chamada por linha não separa duas arrow functions na mesma linha. */
  startIndex: number;
  endIndex: number;
}

/**
 * Uma chamada ainda por NOME: o CodeGraph resolve pra um símbolo depois (e religa quando o alvo muda).
 * `object` é a cadeia do receptor em `obj.name()`, lida da AST: `ns` → ['ns'], `this.repo` → ['this','repo'].
 * Receptor que não é uma cadeia simples (`getRepo().save()`, `a[0].b()`) fica sem `object`.
 */
export interface RawCall {
  caller: string;
  name: string;
  object?: string[];
}

/** `a`, `this`, `a.b.c` → segmentos; qualquer outra expressão → undefined. */
function memberChain(node: SyntaxNode | null): string[] | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier' || node.type === 'this') return [node.text];
  if (node.type !== 'member_expression') return undefined;
  const prop = node.childForFieldName('property');
  const head = memberChain(node.childForFieldName('object'));
  return head && prop?.type === 'property_identifier' ? [...head, prop.text] : undefined;
}

const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** Funções, métodos, classes, e `const f = () => {}` / campo de classe `handle = () => {}`. */
export function extractSymbols(root: SyntaxNode, fileId: string): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  const push = (node: SyntaxNode, kind: SymbolKind, name: string, fn: SyntaxNode) => {
    const paramsNode = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
    results.push({
      id: `${fileId}#${name}:${node.startPosition.row}`,
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: paramsNode?.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    });
  };

  walk(root, (node) => {
    if (node.type === 'function_declaration' || node.type === 'method_definition' || node.type === 'class_declaration') {
      const name = node.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME;
      const kind = node.type === 'class_declaration' ? 'class' : node.type === 'method_definition' ? 'method' : 'function';
      push(node, kind, name, node);
    } else if (node.type === 'variable_declarator' || node.type === 'public_field_definition' || node.type === 'pair') {
      // `const f = () => {}`, campo `handle = () => {}`, e `{ find: async () => {} }` em objeto literal
      const value = node.childForFieldName('value');
      const name = node.childForFieldName(node.type === 'pair' ? 'key' : 'name')?.text;
      if (name && value && FUNCTION_VALUE_TYPES.has(value.type)) {
        push(node, node.type === 'variable_declarator' ? 'function' : 'method', name, value);
      }
    } else if (node.type === 'export_statement') {
      // `export default () => {}` / `export default function () {}` — anônimos ganham o nome `default`
      const value = node.childForFieldName('value');
      if (value && FUNCTION_VALUE_TYPES.has(value.type) && !value.childForFieldName('name')) {
        push(node, 'function', DEFAULT_EXPORT_NAME, value);
      }
    } else if (node.type === 'assignment_expression') {
      // `exports.f = function () {}`, `module.exports = () => {}`, `obj.handler = () => {}`
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left?.type === 'member_expression' && right && FUNCTION_VALUE_TYPES.has(right.type)) {
        const prop = left.childForFieldName('property')?.text;
        const isModuleExports = left.text === 'module.exports';
        const name = isModuleExports ? right.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME : prop;
        if (name) push(node, 'function', name, right);
      }
    }
  });

  return results;
}

/** Cada chamada atribuída ao símbolo MAIS INTERNO que a contém (método, não a classe). */
export function extractCalls(root: SyntaxNode, symbols: SymbolInfo[]): RawCall[] {
  const enclosing = (index: number): string | undefined => {
    let best: SymbolInfo | undefined;
    for (const s of symbols) {
      if (index < s.startIndex || index >= s.endIndex) continue;
      if (!best || s.endIndex - s.startIndex < best.endIndex - best.startIndex) best = s;
    }
    return best?.id;
  };

  const results: RawCall[] = [];
  walk(root, (node) => {
    if (node.type !== 'call_expression' && node.type !== 'new_expression') return;
    const fn = node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor');
    const caller = enclosing(node.startIndex);
    if (!fn || !caller) return;
    if (fn.type === 'identifier') results.push({ caller, name: fn.text });
    else if (fn.type === 'member_expression') {
      const name = fn.childForFieldName('property')?.text;
      if (name) results.push({ caller, name, object: memberChain(fn.childForFieldName('object')) });
    }
  });
  return results;
}
