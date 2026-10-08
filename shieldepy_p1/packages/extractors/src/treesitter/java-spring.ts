// Extrator Java / Spring em cima da AST do Tree-sitter. Acha métodos anotados com
// @EventListener / @TransactionalEventListener:
//   @EventListener
//   public void onOrderUpdated(OrderUpdated e) { e.setTotal(e.getSubtotal()); e.paid = true; }
// evento = tipo do parâmetro (ou `classes = X.class` na anotação); recurso = evento sem o sufixo
// verbal ("OrderUpdated" -> "Order"). Lê/escreve = getters/setters e campos acessados no parâmetro.
// Por ser AST: comentários e strings nunca viram acesso, e o corpo é o bloco real do método.

import type { GrammarParser, SyntaxNode } from '@shieldepy/core';
import { decap, deriveResource, FieldAccess, lastSegment } from '../naming';
import type { ParsedRule } from '../types';

const LISTENER_ANNOTATIONS = new Set(['EventListener', 'TransactionalEventListener']);

export function parseJava(parser: GrammarParser, source: string): ParsedRule[] {
  return parser.withTree(source, extractJavaListeners);
}

export function extractJavaListeners(root: SyntaxNode): ParsedRule[] {
  const out: ParsedRule[] = [];
  walk(root, (node) => {
    if (node.type !== 'method_declaration') return;
    const annotation = listenerAnnotation(node);
    if (!annotation) return;

    const param = node.childForFieldName('parameters')?.namedChildren.find((p) => p.type === 'formal_parameter');
    const event = (param && typeName(param.childForFieldName('type'))) ?? annotatedClass(annotation);
    if (!event) return;
    const paramName = param?.childForFieldName('name')?.text;
    const { reads, writes } = paramName ? accessOn(node.childForFieldName('body'), paramName) : { reads: [], writes: [] };
    out.push({ event, resource: deriveResource(event), reads, writes, line: node.startPosition.row });
  });
  return out;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

function listenerAnnotation(method: SyntaxNode): SyntaxNode | undefined {
  const modifiers = method.namedChildren.find((c) => c.type === 'modifiers');
  return modifiers?.namedChildren.find(
    (a) => (a.type === 'annotation' || a.type === 'marker_annotation') && LISTENER_ANNOTATIONS.has(lastSegment(a.childForFieldName('name')?.text ?? ''))
  );
}

/** `OrderUpdated`, `com.x.OrderUpdated`, `Event<Order>` → nome simples do tipo. */
function typeName(type: SyntaxNode | null | undefined): string | undefined {
  if (!type) return undefined;
  if (type.type === 'type_identifier') return type.text;
  if (type.type === 'scoped_type_identifier') return typeName(type.namedChildren.at(-1));
  if (type.type === 'generic_type') return typeName(type.namedChildren[0]);
  return undefined;
}

/** `@EventListener(classes = OrderUpdated.class)` / `@EventListener(OrderUpdated.class)`. */
function annotatedClass(annotation: SyntaxNode): string | undefined {
  let found: string | undefined;
  walk(annotation, (n) => {
    if (!found && n.type === 'class_literal') found = typeName(n.namedChildren[0]);
  });
  return found;
}

/** `e.setX(..)` escreve x, `e.getX()`/`e.isX()` lê x; `e.x = ..` escreve x, `e.x` lê x. */
function accessOn(body: SyntaxNode | null, param: string): { reads: string[]; writes: string[] } {
  const access = new FieldAccess();
  if (!body) return access.result();
  walk(body, (n) => {
    if (n.type === 'method_invocation' && n.childForFieldName('object')?.text === param) {
      const name = n.childForFieldName('name')?.text ?? '';
      const prop = accessorProperty(name);
      if (prop?.kind === 'set') access.write(prop.field);
      else if (prop?.kind === 'get') access.read(prop.field);
    } else if (n.type === 'field_access' && n.childForFieldName('object')?.text === param) {
      const field = n.childForFieldName('field')?.text;
      if (!field) return;
      const parent = n.parent;
      const isTarget = parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === n.id;
      if (isTarget) {
        access.write(field);
        if (parent.childForFieldName('operator')?.text !== '=') access.read(field); // `+=` também lê
      } else access.read(field);
    }
  });
  return access.result();
}

function accessorProperty(method: string): { kind: 'get' | 'set'; field: string } | undefined {
  for (const [prefix, kind] of [['set', 'set'], ['get', 'get'], ['is', 'get']] as const) {
    const rest = method.slice(prefix.length);
    if (method.startsWith(prefix) && rest.length > 0 && rest[0] === rest[0]!.toUpperCase() && rest[0] !== rest[0]!.toLowerCase()) {
      return { kind, field: decap(rest) };
    }
  }
  return undefined;
}
