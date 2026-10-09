// Utilitários de leitura da AST compartilhados pelos extratores (tudo via nós Tree-sitter, sem regex).

import type { SyntaxNode } from './parser';

/** Nome de um tipo como escrito no código: `Repo` → ['Repo'], `db.Pool` → ['db', 'Pool']. */
export type TypeRef = string[];

export const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

export function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** `a`, `this`, `super`, `a.b.c` → segmentos; qualquer outra expressão → undefined. */
export function memberChain(node: SyntaxNode | null | undefined): string[] | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier' || node.type === 'this' || node.type === 'super') return [node.text];
  if (node.type !== 'member_expression') return undefined;
  const prop = node.childForFieldName('property');
  const head = memberChain(node.childForFieldName('object'));
  return head && prop?.type === 'property_identifier' ? [...head, prop.text] : undefined;
}

/** Tipo nomeado de uma anotação/expressão de tipo: `Repo`, `Repo<X>`, `db.Pool`. União, array etc. → undefined. */
export function typeRef(node: SyntaxNode | null | undefined): TypeRef | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'type_annotation':
      return typeRef(node.namedChildren[0]);
    case 'type_identifier':
    case 'identifier':
      return [node.text];
    case 'generic_type':
      return typeRef(node.childForFieldName('name') ?? node.namedChildren[0]);
    case 'nested_type_identifier':
      return node.namedChildren.flatMap((c) => typeRef(c) ?? []);
    case 'member_expression':
      return memberChain(node);
    default:
      return undefined;
  }
}

/**
 * `new X()` → X. Também o singleton de desenvolvimento `global.prisma || new PrismaClient()`
 * (e `??`): o valor, quando não veio do cache, é o construído.
 */
export function constructedType(value: SyntaxNode | null | undefined): TypeRef | undefined {
  if (value?.type === 'await_expression' || value?.type === 'parenthesized_expression') return constructedType(value.namedChildren[0]);
  if (value?.type === 'binary_expression') {
    const op = value.childForFieldName('operator')?.type;
    if (op !== '||' && op !== '??') return undefined;
    return constructedType(value.childForFieldName('right')) ?? constructedType(value.childForFieldName('left'));
  }
  if (value?.type !== 'new_expression') return undefined;
  return typeRef(value.childForFieldName('constructor'));
}
