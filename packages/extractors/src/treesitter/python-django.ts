// Extrator Python / Django em cima da AST do Tree-sitter. Acha receivers de signals:
//   @receiver(pre_save, sender=Order)                 def apply_tax(sender, instance, **kw): ...
//   @receiver([pre_save, post_save], sender=Order)    → uma regra por signal
//   pre_save.connect(apply_tax, sender=Order)         → registro sem decorator
// evento = o signal; recurso = o sender. Lê/escreve = atributos do parâmetro da instância
// (`instance.total = ...` escreve; `instance.n += 1` escreve e lê; o resto lê).

import type { GrammarParser, SyntaxNode } from '@shieldepy/core';
import { FieldAccess, lastSegment } from '../naming';
import type { ParsedRule } from '../types';

const PARAM_WITH_NAME = new Set(['typed_parameter', 'default_parameter', 'typed_default_parameter']);

export function parsePython(parser: GrammarParser, source: string): ParsedRule[] {
  return parser.withTree(source, extractDjangoReceivers);
}

export function extractDjangoReceivers(root: SyntaxNode): ParsedRule[] {
  const functions = new Map<string, SyntaxNode>();
  walk(root, (n) => {
    if (n.type === 'function_definition') {
      const name = n.childForFieldName('name')?.text;
      if (name) functions.set(name, n);
    }
  });

  const out: ParsedRule[] = [];
  const emit = (signals: string[], sender: string | undefined, fn: SyntaxNode, line: number) => {
    if (!sender) return;
    const { reads, writes } = accessOn(fn, instanceParam(fn));
    for (const event of signals) out.push({ event, resource: sender, reads, writes, line });
  };

  walk(root, (n) => {
    if (n.type === 'decorated_definition') {
      const fn = n.childForFieldName('definition');
      if (fn?.type !== 'function_definition') return;
      for (const decorator of n.namedChildren.filter((c) => c.type === 'decorator')) {
        const call = decorator.namedChildren[0];
        if (call?.type !== 'call' || lastSegment(call.childForFieldName('function')?.text ?? '') !== 'receiver') continue;
        const args = call.childForFieldName('arguments');
        emit(signalNames(args?.namedChildren[0]), keyword(args, 'sender'), fn, n.startPosition.row);
      }
    } else if (n.type === 'call') {
      // pre_save.connect(apply_tax, sender=Order)
      const callee = n.childForFieldName('function');
      if (callee?.type !== 'attribute' || callee.childForFieldName('attribute')?.text !== 'connect') return;
      const args = n.childForFieldName('arguments');
      const handler = args?.namedChildren[0];
      const fn = handler?.type === 'identifier' ? functions.get(handler.text) : undefined;
      const signal = callee.childForFieldName('object');
      if (fn && signal) emit(signalNames(signal), keyword(args, 'sender'), fn, n.startPosition.row);
    }
  });
  return out;
}

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** `pre_save`, `signals.pre_save`, `[pre_save, post_save]` → nomes simples. */
function signalNames(node: SyntaxNode | null | undefined): string[] {
  if (!node) return [];
  if (node.type === 'list' || node.type === 'tuple') return node.namedChildren.flatMap(signalNames);
  if (node.type === 'identifier' || node.type === 'attribute') return [lastSegment(node.text)];
  return [];
}

function keyword(args: SyntaxNode | null | undefined, name: string): string | undefined {
  const kw = args?.namedChildren.find((a) => a.type === 'keyword_argument' && a.childForFieldName('name')?.text === name);
  const value = kw?.childForFieldName('value');
  return value && (value.type === 'identifier' || value.type === 'attribute') ? lastSegment(value.text) : undefined;
}

/**
 * Parâmetro que recebe a instância. Pela convenção do Django é `instance` (passado por keyword);
 * se não houver, é o segundo posicional depois de `sender`.
 */
function instanceParam(fn: SyntaxNode): string {
  const names: string[] = [];
  for (const p of fn.childForFieldName('parameters')?.namedChildren ?? []) {
    let id: SyntaxNode | null | undefined;
    if (p.type === 'identifier') id = p;
    else if (PARAM_WITH_NAME.has(p.type)) id = p.childForFieldName('name') ?? p.namedChildren.find((c) => c.type === 'identifier');
    if (id) names.push(id.text);
  }
  if (names.includes('instance')) return 'instance';
  return names[1] ?? 'instance';
}

function accessOn(fn: SyntaxNode, param: string): { reads: string[]; writes: string[] } {
  const access = new FieldAccess();
  const body = fn.childForFieldName('body');
  if (!body) return access.result();
  walk(body, (n) => {
    if (n.type !== 'attribute' || n.childForFieldName('object')?.text !== param) return;
    const field = n.childForFieldName('attribute')?.text;
    if (!field) return;
    const parent = n.parent;
    // método chamado na instância (`instance.save()`) não é leitura de campo
    if (parent?.type === 'call' && parent.childForFieldName('function')?.id === n.id) return;
    const isTarget =
      (parent?.type === 'assignment' || parent?.type === 'augmented_assignment') && parent.childForFieldName('left')?.id === n.id;
    if (isTarget) {
      access.write(field);
      if (parent.type === 'augmented_assignment') access.read(field);
    } else access.read(field);
  });
  return access.result();
}
