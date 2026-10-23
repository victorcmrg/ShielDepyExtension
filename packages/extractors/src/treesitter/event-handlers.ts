// Extrator de regras TS/JS em cima da AST do Tree-sitter.
// Acha registros de handler (`bus.on('evento', handler)`, `emitter.once(...)`, `addListener`)
// e o que o handler LÊ e ESCREVE no payload. Por ser AST, cobre:
//   - destructuring do parâmetro      `({ total }) => ...`            (lê total)
//   - alias                           `const o = order; o.total = 1`  (escreve total)
//   - handler nomeado                 `bus.on('e', applyTax)`
//   - `+=`, `++`, `order['total']`, `Object.assign(order, { total })`
//   - sombreamento em função aninhada (um `order` interno não é o payload)
//   - chamada de método (`order.recalc()`) NÃO conta como leitura de campo

import type { SyntaxNode, TsParser } from '@shieldepy/core';
import type { ParsedRule } from '../types';
import { prefixResource } from '../naming';

const LISTEN_METHODS = new Set(['on', 'once', 'addListener', 'prependListener', 'prependOnceListener']);
const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function', 'function_declaration']);

/** Regras dos handlers de evento de uma árvore já parseada (reaproveita o parse do CodeGraph). */
export function extractEventHandlers(root: SyntaxNode): ParsedRule[] {
  const namedFunctions = collectNamedFunctions(root);
  const out: ParsedRule[] = [];

  walk(root, (node) => {
    if (node.type !== 'call_expression') return;
    const event = registeredEvent(node);
    if (event === undefined) return;

    const args = node.childForFieldName('arguments')?.namedChildren ?? [];
    const handler = resolveHandler(args[args.length - 1], namedFunctions);
    if (!handler || args.length < 2) return;

    const { reads, writes } = payloadAccess(handler);
    out.push({ event, resource: prefixResource(event), reads, writes, line: node.startPosition.row });
  });

  return out;
}

/** Versão autônoma: parseia o texto, extrai e libera a árvore. */
export function parseTsHandlers(parser: TsParser, source: string, jsx = false): ParsedRule[] {
  return parser.withTree(source, jsx, extractEventHandlers);
}

// ---------------------------------------------------------------------------------------

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

/** Nome do evento se a chamada for um registro de handler (`x.on('evt', ...)` / `on('evt', ...)`). */
function registeredEvent(call: SyntaxNode): string | undefined {
  const fn = call.childForFieldName('function');
  const method =
    fn?.type === 'identifier' ? fn.text : fn?.type === 'member_expression' ? fn.childForFieldName('property')?.text : undefined;
  if (!method || !LISTEN_METHODS.has(method)) return undefined;
  const first = call.childForFieldName('arguments')?.namedChildren[0];
  return first ? stringValue(first) : undefined;
}

/** Valor de um literal de string (ou template sem `${}`); `undefined` se não for estático. */
function stringValue(node: SyntaxNode): string | undefined {
  if (node.type === 'string') return node.text.slice(1, -1);
  if (node.type === 'template_string' && !node.namedChildren.some((c) => c.type === 'template_substitution')) {
    return node.text.slice(1, -1);
  }
  return undefined;
}

function collectNamedFunctions(root: SyntaxNode): Map<string, SyntaxNode> {
  const map = new Map<string, SyntaxNode>();
  walk(root, (node) => {
    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text;
      if (name) map.set(name, node);
    } else if (node.type === 'variable_declarator') {
      const name = node.childForFieldName('name');
      const value = node.childForFieldName('value');
      if (name?.type === 'identifier' && value && FUNCTION_TYPES.has(value.type)) map.set(name.text, value);
    }
  });
  return map;
}

function resolveHandler(arg: SyntaxNode | undefined, named: Map<string, SyntaxNode>): SyntaxNode | undefined {
  if (!arg) return undefined;
  if (FUNCTION_TYPES.has(arg.type)) return arg;
  if (arg.type === 'identifier') return named.get(arg.text);
  return undefined;
}

/** Nós que declaram parâmetros de uma função: identificadores e padrões de destructuring. */
function parameterPatterns(fn: SyntaxNode): SyntaxNode[] {
  const single = fn.childForFieldName('parameter'); // `x => ...` sem parênteses
  if (single) return [single];
  const params = fn.childForFieldName('parameters');
  if (!params) return [];
  return params.namedChildren.map((p) => p.childForFieldName('pattern') ?? p);
}

/** Nomes de campo de um `{ a, b: c, d = 1, ...rest }`. */
function patternKeys(pattern: SyntaxNode): string[] {
  const keys: string[] = [];
  for (const child of pattern.namedChildren) {
    if (child.type === 'shorthand_property_identifier_pattern') keys.push(child.text);
    else if (child.type === 'pair_pattern') {
      const key = child.childForFieldName('key');
      if (key) keys.push(key.type === 'string' ? key.text.slice(1, -1) : key.text);
    } else if (child.type === 'object_assignment_pattern') {
      const left = child.childForFieldName('left');
      if (left) keys.push(left.text);
    }
  }
  return keys;
}

/** Nomes que um parâmetro introduz no escopo (pra detectar sombreamento). */
function boundNames(pattern: SyntaxNode): string[] {
  if (pattern.type === 'identifier') return [pattern.text];
  const names: string[] = [];
  walk(pattern, (n) => {
    if (n.type === 'identifier' || n.type === 'shorthand_property_identifier_pattern') names.push(n.text);
  });
  return names;
}

/** O que o handler lê/escreve no seu PRIMEIRO parâmetro (o payload do evento). */
function payloadAccess(fn: SyntaxNode): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const payload = parameterPatterns(fn)[0];
  const body = fn.childForFieldName('body');
  if (!payload || !body) return { reads: [], writes: [] };

  if (payload.type === 'object_pattern') {
    for (const k of patternKeys(payload)) reads.add(k); // destructuring no parâmetro = leitura
    return { reads: [...reads].sort(), writes: [] };
  }
  if (payload.type !== 'identifier') return { reads: [], writes: [] };

  /** `alias.campo` ou `alias['campo']` → nome do campo, se o objeto for um alias do payload. */
  const fieldOf = (node: SyntaxNode | null, aliases: Set<string>): string | undefined => {
    if (!node) return undefined;
    const obj = node.childForFieldName('object');
    if (obj?.type !== 'identifier' || !aliases.has(obj.text)) return undefined;
    if (node.type === 'member_expression') return node.childForFieldName('property')?.text;
    if (node.type === 'subscript_expression') {
      const index = node.childForFieldName('index');
      return index ? stringValue(index) : undefined;
    }
    return undefined;
  };

  const visit = (node: SyntaxNode, aliases: Set<string>): void => {
    // Função aninhada que declara um parâmetro com o mesmo nome: dentro dela, não é o payload.
    if (FUNCTION_TYPES.has(node.type) && node !== fn) {
      const shadowed = parameterPatterns(node).flatMap(boundNames).filter((n) => aliases.has(n));
      if (shadowed.length > 0) {
        const inner = new Set([...aliases].filter((a) => !shadowed.includes(a)));
        if (inner.size === 0) return;
        aliases = inner;
      }
    }

    switch (node.type) {
      case 'variable_declarator': {
        const name = node.childForFieldName('name');
        const value = node.childForFieldName('value');
        if (value?.type === 'identifier' && aliases.has(value.text) && name) {
          if (name.type === 'identifier') aliases.add(name.text); // const o = order
          else if (name.type === 'object_pattern') for (const k of patternKeys(name)) reads.add(k); // const { total } = order
          return;
        }
        break;
      }
      case 'assignment_expression': {
        const left = node.childForFieldName('left');
        const field = fieldOf(left, aliases);
        if (field) {
          writes.add(field);
          const right = node.childForFieldName('right');
          if (right) visit(right, aliases);
          return;
        }
        break;
      }
      case 'augmented_assignment_expression': {
        const field = fieldOf(node.childForFieldName('left'), aliases);
        if (field) {
          writes.add(field);
          reads.add(field); // `x.total += 1` lê antes de escrever
          const right = node.childForFieldName('right');
          if (right) visit(right, aliases);
          return;
        }
        break;
      }
      case 'update_expression': {
        const field = fieldOf(node.childForFieldName('argument'), aliases);
        if (field) {
          writes.add(field);
          reads.add(field);
          return;
        }
        break;
      }
      case 'call_expression': {
        const callee = node.childForFieldName('function');
        const args = node.childForFieldName('arguments')?.namedChildren ?? [];
        // Object.assign(order, { total: 1 }) escreve as chaves dos objetos seguintes.
        if (callee?.text === 'Object.assign' && args[0]?.type === 'identifier' && aliases.has(args[0].text)) {
          for (const src of args.slice(1)) {
            if (src.type === 'object') {
              for (const prop of src.namedChildren) {
                const key = prop.type === 'pair' ? prop.childForFieldName('key')?.text : prop.type === 'shorthand_property_identifier' ? prop.text : undefined;
                if (key) writes.add(key);
              }
            }
            visit(src, aliases);
          }
          return;
        }
        // order.recalc(): chamada de método, não leitura de campo — só os argumentos importam.
        if (fieldOf(callee, aliases) !== undefined) {
          for (const a of args) visit(a, aliases);
          return;
        }
        break;
      }
      case 'member_expression':
      case 'subscript_expression': {
        const field = fieldOf(node, aliases);
        if (field) {
          reads.add(field);
          if (node.type === 'subscript_expression') {
            const index = node.childForFieldName('index');
            if (index) visit(index, aliases);
          }
          return;
        }
        break;
      }
    }

    for (const child of node.namedChildren) visit(child, aliases);
  };

  visit(body, new Set([payload.text]));
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}
