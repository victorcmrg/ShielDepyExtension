// Utilitários de leitura da AST compartilhados pelos extratores (tudo via nós Tree-sitter, sem regex).

import type { SyntaxNode } from './parser';
import { PlainNode } from './plain-tree';

/** Nome de um tipo como escrito no código: `Repo` → ['Repo'], `db.Pool` → ['db', 'Pool']. */
export type TypeRef = string[];

export const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

/**
 * Visita `node` e todos os descendentes nomeados, em profundidade e na ordem do código (a mesma de
 * descer por `namedChildren`). Com o cursor do Tree-sitter: descer por `namedChildren` montava a lista
 * de filhos de cada nó do outro lado do WASM, e isso pesava na indexação. Como antes, não desce
 * dentro de um nó anônimo (os tokens).
 */
export function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  // na cópia em JavaScript (plain-tree.ts), descer pelos filhos já é barato
  if (node instanceof PlainNode) return walkPlain(node, visit);
  visit(node);
  const cursor = node.walk();
  try {
    if (!cursor.gotoFirstChild()) return;
    let depth = 1;
    for (;;) {
      if (cursor.nodeIsNamed) {
        visit(cursor.currentNode);
        if (cursor.gotoFirstChild()) {
          depth++;
          continue;
        }
      }
      while (!cursor.gotoNextSibling()) {
        if (--depth === 0 || !cursor.gotoParent()) return;
      }
    }
  } finally {
    cursor.delete();
  }
}

function walkPlain(node: PlainNode, visit: (n: SyntaxNode) => void): void {
  visit(node as unknown as SyntaxNode);
  for (const child of node.namedChildren) walkPlain(child, visit);
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

/** O nome da lista em `routes` ou `Object.values(routes)`. */
export function listName(node: SyntaxNode | null | undefined): string | undefined {
  if (node?.type === 'identifier') return node.text;
  if (node?.type !== 'call_expression') return undefined;
  const chain = memberChain(node.childForFieldName('function'));
  const args = node.childForFieldName('arguments')?.namedChildren.filter((a) => a.type !== 'comment');
  return chain?.join('.') === 'Object.values' && args?.length === 1 && args[0]!.type === 'identifier' ? args[0]!.text : undefined;
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
