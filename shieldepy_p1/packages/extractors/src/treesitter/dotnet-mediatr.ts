// Extrator .NET / C# (MediatR) em cima da AST do Tree-sitter. Acha handlers de notificação:
//   public class TaxHandler : INotificationHandler<OrderUpdated> {
//     public Task Handle(OrderUpdated notification, CancellationToken ct) { notification.Total = ...; }
//   }
// evento = tipo em INotificationHandler<T> (uma classe pode implementar vários — cada `Handle`
// é casado pelo tipo do 1º parâmetro); recurso = evento sem sufixo verbal. Lê/escreve =
// propriedades acessadas no parâmetro (normalizadas pra minúscula inicial).

import type { GrammarParser, SyntaxNode } from '@shieldepy/core';
import { decap, deriveResource, FieldAccess, lastSegment } from '../naming';
import type { ParsedRule } from '../types';

const HANDLER_INTERFACE = 'INotificationHandler';

export function parseCSharp(parser: GrammarParser, source: string): ParsedRule[] {
  return parser.withTree(source, extractMediatrHandlers);
}

export function extractMediatrHandlers(root: SyntaxNode): ParsedRule[] {
  const out: ParsedRule[] = [];
  walk(root, (cls) => {
    if (cls.type !== 'class_declaration' && cls.type !== 'record_declaration') return;
    const events = handledEvents(cls);
    if (events.length === 0) return;
    const body = cls.childForFieldName('body');
    for (const method of body?.namedChildren ?? []) {
      if (method.type !== 'method_declaration' || method.childForFieldName('name')?.text !== 'Handle') continue;
      const param = method.childForFieldName('parameters')?.namedChildren.find((p) => p.type === 'parameter');
      const paramType = param ? lastSegment(param.childForFieldName('type')?.text ?? '') : undefined;
      const event = events.find((e) => e === paramType) ?? (events.length === 1 ? events[0] : undefined);
      const paramName = param?.childForFieldName('name')?.text;
      if (!event || !paramName) continue;
      const { reads, writes } = accessOn(method.childForFieldName('body'), paramName);
      out.push({ event, resource: deriveResource(event), reads, writes, line: method.startPosition.row });
    }
  });
  return out;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** Tipos T de cada `INotificationHandler<T>` na lista de bases da classe. */
function handledEvents(cls: SyntaxNode): string[] {
  const bases = cls.childForFieldName('bases') ?? cls.namedChildren.find((c) => c.type === 'base_list');
  const events: string[] = [];
  for (const base of bases?.namedChildren ?? []) {
    const generic =
      base.type === 'generic_name' ? base : base.type === 'qualified_name' ? base.namedChildren.find((c) => c.type === 'generic_name') : undefined;
    if (!generic || generic.namedChildren[0]?.text !== HANDLER_INTERFACE) continue;
    const arg = generic.namedChildren.find((c) => c.type === 'type_argument_list')?.namedChildren[0];
    if (arg) events.push(lastSegment(arg.text));
  }
  return events;
}

function accessOn(body: SyntaxNode | null, param: string): { reads: string[]; writes: string[] } {
  const access = new FieldAccess();
  if (!body) return access.result(decap);
  walk(body, (n) => {
    if (n.type !== 'member_access_expression' || n.childForFieldName('expression')?.text !== param) return;
    const field = n.childForFieldName('name')?.text;
    if (!field) return;
    const parent = n.parent;
    // método chamado no parâmetro (`n.Recalc()`) não é leitura de propriedade
    if (parent?.type === 'invocation_expression' && parent.childForFieldName('function')?.id === n.id) return;
    const isTarget = parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === n.id;
    if (isTarget) {
      access.write(field);
      const op = parent.namedChildren.find((c) => c.type === 'assignment_operator')?.text;
      if (op !== undefined && op !== '=') access.read(field); // `+=` também lê
    } else if (parent?.type === 'prefix_unary_expression' || parent?.type === 'postfix_unary_expression') {
      access.write(field); // `n.Count++`
      access.read(field);
    } else access.read(field);
  });
  return access.result(decap);
}
