// Leitura da árvore Tree-sitter de um arquivo TS/JS: símbolos, chamadas e referências.
// Funções puras — não sabem nada do grafo; o CodeGraph decide o que fazer com o resultado.
// Tudo aqui é lido da AST: nada de regex sobre o texto do código.

import { constructedType, FUNCTION_VALUE_TYPES, memberChain, typeRef, walk, type TypeRef } from './ast';
import { DEFAULT_EXPORT_NAME } from './extract-module';
import type { SyntaxNode } from './parser';
import type { SymbolKind } from './types';

export type { TypeRef } from './ast';

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
  /** Método: nome da classe ou do objeto literal (`const repo = { save() {} }`) que o contém. */
  container?: string;
  /** Classe: `extends` e `implements`. */
  extends?: TypeRef;
  implements?: string[];
  /** Classe: tipo de cada campo conhecido (campo tipado, `= new X()`, `constructor(private x: X)`, `this.x = ...`). */
  fields?: Record<string, TypeRef>;
  /** Classe: nomes de TODAS as propriedades (com ou sem tipo conhecido) — `this.log()` com `log: (m) => void` é valor, não método. */
  properties?: string[];
}

/**
 * O que se sabe estaticamente sobre o receptor de `obj.m()`:
 * `type` é o tipo da parte inicial da cadeia; `rest` são as propriedades que ainda faltam
 * percorrer até o método (`this.deps.repo.save()` com `deps: Deps` → type Deps, rest ['repo']).
 */
export interface Receiver {
  type: TypeRef;
  rest: string[];
}

/**
 * Uma chamada (ou referência) ainda por NOME: o CodeGraph resolve pra um símbolo depois (e religa
 * quando o alvo muda). `object` é a cadeia do receptor lida da AST: `ns.f()` → ['ns'],
 * `this.repo.save()` → ['this','repo']; receptor que não é cadeia simples (`get().save()`) fica sem.
 */
export interface RawCall {
  caller: string;
  name: string;
  object?: string[];
  /** Tipo do receptor quando dá pra saber no próprio arquivo. */
  receiver?: Receiver;
  /** O receptor é uma variável local sem tipo conhecido — não confundir com um import de mesmo nome. */
  shadowed?: boolean;
  /** O receptor é local e de tipo nativo/estrutural (`X[]`, `string`, `[]`, `''`) — nunca é código do projeto. */
  opaque?: boolean;
  /** `ref`: função passada como valor (`app.post('/x', handler)`), vira aresta `references`. */
  kind?: 'call' | 'ref';
  /** Referência a um símbolo já conhecido (callback anônimo que virou símbolo). */
  symbolId?: string;
}

const FUNCTION_SCOPE_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'method_definition',
  'arrow_function',
  'function_expression',
  'function',
]);
const CLASS_TYPES = new Set(['class_declaration', 'abstract_class_declaration', 'class']);
const BLOCK_TYPES = new Set(['statement_block', 'program']);

function enclosingClass(node: SyntaxNode): SyntaxNode | undefined {
  for (let n = node.parent; n; n = n.parent) if (CLASS_TYPES.has(n.type)) return n;
  return undefined;
}

function className(cls: SyntaxNode): string {
  if (cls.type === 'class' && !cls.childForFieldName('name')) {
    // `const Repo = class { ... }`
    const decl = cls.parent?.type === 'variable_declarator' ? cls.parent.childForFieldName('name')?.text : undefined;
    if (decl) return decl;
  }
  return cls.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME;
}

function heritage(cls: SyntaxNode): { extends?: TypeRef; implements?: string[] } {
  const h = cls.namedChildren.find((c) => c.type === 'class_heritage');
  if (!h) return {};
  const ext = h.namedChildren.find((c) => c.type === 'extends_clause');
  const impl = h.namedChildren.find((c) => c.type === 'implements_clause');
  return {
    extends: typeRef(ext?.childForFieldName('value') ?? ext?.namedChildren[0]),
    implements: impl?.namedChildren.map((c) => typeRef(c)?.at(-1)).filter((n): n is string => !!n),
  };
}

function paramName(param: SyntaxNode): string | undefined {
  const pattern = param.childForFieldName('pattern') ?? param;
  return pattern.type === 'identifier' ? pattern.text : undefined;
}

/** Tipos dos campos de uma classe (o que permite seguir `this.repo.save()`) e o nome de todas as propriedades. */
export function classFields(cls: SyntaxNode): { fields: Record<string, TypeRef>; properties: string[] } {
  const fields: Record<string, TypeRef> = {};
  const properties = new Set<string>();
  const body = cls.childForFieldName('body');
  for (const member of body?.namedChildren ?? []) {
    if (member.type === 'public_field_definition') {
      const name = member.childForFieldName('name')?.text;
      const type = typeRef(member.childForFieldName('type')) ?? constructedType(member.childForFieldName('value'));
      if (name) properties.add(name);
      if (name && type) fields[name] = type;
    } else if (member.type === 'method_definition' && member.childForFieldName('name')?.text === 'constructor') {
      const paramTypes = new Map<string, TypeRef>();
      for (const p of member.childForFieldName('parameters')?.namedChildren ?? []) {
        const name = paramName(p);
        if (!name) continue;
        // parameter property: `constructor(private readonly repo: Repo)`
        const isProperty = p.children.some((c) => c.type === 'accessibility_modifier' || c.type === 'readonly');
        if (isProperty) properties.add(name);
        const type = typeRef(p.childForFieldName('type'));
        if (!type) continue;
        paramTypes.set(name, type);
        if (isProperty) fields[name] = type;
      }
      walk(member.childForFieldName('body') ?? member, (n) => {
        if (n.type !== 'assignment_expression') return;
        const left = n.childForFieldName('left');
        if (left?.type !== 'member_expression' || left.childForFieldName('object')?.type !== 'this') return;
        const field = left.childForFieldName('property')?.text;
        if (field) properties.add(field);
        const right = n.childForFieldName('right');
        const type = constructedType(right) ?? (right?.type === 'identifier' ? paramTypes.get(right.text) : undefined);
        if (field && type && !fields[field]) fields[field] = type;
      });
    }
  }
  return { fields, properties: [...properties] };
}

function isRequire(node: SyntaxNode): boolean {
  const fn = node.type === 'call_expression' ? node.childForFieldName('function') : undefined;
  return fn?.type === 'identifier' && fn.text === 'require';
}

const OPAQUE_VALUE_TYPES = new Set(['array', 'string', 'template_string', 'number', 'true', 'false', 'regex']);
const LOOSE_TYPES = new Set(['any', 'unknown']);

/** Tipo anotado que não é nominal (`X[]`, `string`, união) → opaco; `any`/`unknown` → sem tipo (null). */
function annotatedType(annotation: SyntaxNode | null | undefined): TypeRef | null | 'opaque' {
  if (!annotation) return null;
  const ref = typeRef(annotation);
  if (ref) return ref;
  const inner = annotation.type === 'type_annotation' ? annotation.namedChildren[0] : annotation;
  return inner?.type === 'predefined_type' && LOOSE_TYPES.has(inner.text) ? null : 'opaque';
}

/**
 * Tipo de uma variável/parâmetro visível em `from`, procurando nos escopos de dentro pra fora.
 * `undefined` = não é local (pode ser import ou global); `null` = é local mas sem tipo conhecido;
 * `'opaque'` = é local e de tipo nativo/estrutural.
 */
function localType(from: SyntaxNode, name: string): TypeRef | null | 'opaque' | undefined {
  for (let n = from.parent; n; n = n.parent) {
    if (FUNCTION_SCOPE_TYPES.has(n.type)) {
      const single = n.childForFieldName('parameter');
      if (single?.type === 'identifier' && single.text === name) return null;
      for (const p of n.childForFieldName('parameters')?.namedChildren ?? []) {
        if (paramName(p) === name) return annotatedType(p.childForFieldName('type'));
      }
    }
    if (BLOCK_TYPES.has(n.type)) {
      for (const stmt of n.namedChildren) {
        const decl = stmt.type === 'export_statement' ? stmt.childForFieldName('declaration') : stmt;
        if (decl?.type !== 'lexical_declaration' && decl?.type !== 'variable_declaration') continue;
        for (const d of decl.namedChildren) {
          if (d.type !== 'variable_declarator' || d.childForFieldName('name')?.text !== name) continue;
          const value = d.childForFieldName('value');
          // `const f = () => {}` é símbolo, `const o = { m() {} }` tem métodos e `require()` é import: o grafo resolve
          if (value && (FUNCTION_VALUE_TYPES.has(value.type) || value.type === 'object' || isRequire(value))) return undefined;
          const annotated = annotatedType(d.childForFieldName('type'));
          if (annotated !== null) return annotated;
          if (value && OPAQUE_VALUE_TYPES.has(value.type)) return 'opaque';
          return constructedType(value) ?? null;
        }
      }
    }
  }
  return undefined;
}

function receiverOf(node: SyntaxNode, chain: string[]): { receiver?: Receiver; shadowed?: boolean; opaque?: boolean } {
  const [root, ...rest] = chain;
  if (root === 'this' || root === 'super') {
    const cls = enclosingClass(node);
    if (!cls) return {};
    if (root === 'super') {
      const base = heritage(cls).extends;
      return base ? { receiver: { type: base, rest } } : {};
    }
    // `this.m()` → a própria classe; `this.repo.save()` → o tipo do campo (resolvido no grafo, com herança)
    return { receiver: { type: [className(cls)], rest } };
  }
  const t = localType(node, root!);
  if (t === null) return { shadowed: true };
  if (t === 'opaque') return { shadowed: true, opaque: true };
  return t ? { receiver: { type: t, rest } } : {};
}

/** Nome do contêiner de um método: classe, ou variável que guarda o objeto literal. */
function containerOf(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (parent?.type === 'class_body' && parent.parent) return className(parent.parent);
  if (parent?.type === 'object' && parent.parent?.type === 'variable_declarator') {
    return parent.parent.childForFieldName('name')?.text;
  }
  return undefined;
}

/** `app.post('/checkout')` — rótulo de um callback anônimo passado num nível em que não há função envolvente. */
function callbackLabel(call: SyntaxNode): string {
  const fn = call.childForFieldName('function');
  const callee = memberChain(fn)?.join('.') ?? 'callback';
  const first = call.childForFieldName('arguments')?.namedChildren[0];
  const literal = first?.type === 'string' ? first.text : '';
  return `${callee}(${literal})`;
}

/**
 * Funções, métodos, classes, `const f = () => {}`, campo `handle = () => {}`, funções em objeto
 * literal, `exports.f = function`, e callbacks anônimos no topo do arquivo (`app.post('/x', async () => {})`)
 * — sem este último, as chamadas de dentro de um handler Express inline se perdiam.
 */
export function extractSymbols(root: SyntaxNode, fileId: string): SymbolInfo[] {
  const results: SymbolInfo[] = [];

  const push = (node: SyntaxNode, kind: SymbolKind, name: string, fn: SyntaxNode, extra: Partial<SymbolInfo> = {}) => {
    const paramsNode = fn.childForFieldName('parameters') ?? fn.childForFieldName('parameter');
    const info: SymbolInfo = {
      id: `${fileId}#${name}:${node.startPosition.row}`,
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: paramsNode?.text,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (info as unknown as Record<string, unknown>)[k] = v;
    results.push(info);
  };
  const insideFunction = (node: SyntaxNode) => {
    for (let n = node.parent; n; n = n.parent) if (FUNCTION_SCOPE_TYPES.has(n.type) || CLASS_TYPES.has(n.type)) return true;
    return false;
  };

  walk(root, (node) => {
    if (CLASS_TYPES.has(node.type) && (node.type !== 'class' || node.parent?.type === 'variable_declarator')) {
      const h = heritage(node);
      const { fields, properties } = classFields(node);
      push(node, 'class', className(node), node, {
        extends: h.extends,
        implements: h.implements?.length ? h.implements : undefined,
        fields: Object.keys(fields).length > 0 ? fields : undefined,
        properties: properties.length > 0 ? properties : undefined,
      });
    } else if (node.type === 'function_declaration' || node.type === 'generator_function_declaration' || node.type === 'method_definition') {
      const name = node.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME;
      if (node.type === 'method_definition') push(node, 'method', name, node, { container: containerOf(node) });
      else push(node, 'function', name, node);
    } else if (node.type === 'variable_declarator' || node.type === 'public_field_definition' || node.type === 'pair') {
      // `const f = () => {}`, campo `handle = () => {}`, e `{ find: async () => {} }` em objeto literal
      const value = node.childForFieldName('value');
      const name = node.childForFieldName(node.type === 'pair' ? 'key' : 'name')?.text;
      if (name && value && FUNCTION_VALUE_TYPES.has(value.type)) {
        if (node.type === 'variable_declarator') push(node, 'function', name, value);
        else push(node, 'method', name, value, { container: containerOf(node) });
      }
    } else if (node.type === 'export_statement') {
      // `export default () => {}` / `export default function () {}` — anônimos ganham o nome `default`
      const value = node.childForFieldName('value');
      if (value && FUNCTION_VALUE_TYPES.has(value.type) && !value.childForFieldName('name')) {
        push(node, 'function', DEFAULT_EXPORT_NAME, value);
      }
    } else if (node.type === 'assignment_expression') {
      // `exports.f = function () {}`, `module.exports = () => {}`, `this.handler = () => {}`
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left?.type === 'member_expression' && right && FUNCTION_VALUE_TYPES.has(right.type)) {
        const prop = left.childForFieldName('property')?.text;
        const isModuleExports = left.text === 'module.exports';
        const name = isModuleExports ? right.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME : prop;
        const cls = left.childForFieldName('object')?.type === 'this' ? enclosingClass(node) : undefined;
        if (name && cls) push(node, 'method', name, right, { container: className(cls) });
        else if (name) push(node, 'function', name, right);
      }
    } else if (node.type === 'arguments' && node.parent?.type === 'call_expression' && !insideFunction(node)) {
      const label = callbackLabel(node.parent);
      for (const arg of node.namedChildren) {
        if (FUNCTION_VALUE_TYPES.has(arg.type)) push(arg, 'function', label, arg);
      }
    }
  });

  return results;
}

/**
 * Chamadas, cada uma atribuída ao símbolo MAIS INTERNO que a contém (método, não a classe), com o
 * tipo do receptor quando o arquivo deixa saber. Também as referências: função passada como
 * argumento (`router.use(auth)`, `app.post('/x', ctrl.create)`), atribuídas ao símbolo envolvente
 * ou, no topo do arquivo, ao próprio arquivo (`fileId`).
 */
export function extractCalls(root: SyntaxNode, symbols: SymbolInfo[], fileId?: string): RawCall[] {
  const enclosing = (index: number): string | undefined => {
    let best: SymbolInfo | undefined;
    for (const s of symbols) {
      if (index < s.startIndex || index >= s.endIndex) continue;
      if (!best || s.endIndex - s.startIndex < best.endIndex - best.startIndex) best = s;
    }
    return best?.id;
  };
  const symbolAt = new Map(symbols.map((s) => [s.startIndex, s]));

  const results: RawCall[] = [];
  walk(root, (node) => {
    if (node.type === 'call_expression' || node.type === 'new_expression') {
      const fn = node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor');
      const caller = enclosing(node.startIndex);
      if (!fn || !caller) return;
      if (fn.type === 'identifier') {
        const local = localType(node, fn.text);
        results.push({ caller, name: fn.text, ...(local === null || local === 'opaque' ? { shadowed: true } : {}) });
      } else if (fn.type === 'member_expression') {
        const name = fn.childForFieldName('property')?.text;
        const object = memberChain(fn.childForFieldName('object'));
        if (name) results.push({ caller, name, object, ...(object ? receiverOf(node, object) : {}) });
      }
      return;
    }

    if (node.type === 'arguments' && node.parent?.type === 'call_expression') {
      const caller = enclosing(node.startIndex) ?? fileId;
      if (!caller) return;
      for (const arg of node.namedChildren) {
        const callback = FUNCTION_VALUE_TYPES.has(arg.type) ? symbolAt.get(arg.startIndex) : undefined;
        if (callback) {
          results.push({ caller, name: callback.name, kind: 'ref', symbolId: callback.id });
          continue;
        }
        const chain = memberChain(arg);
        if (!chain || chain[0] === 'super') continue;
        if (chain.length === 1) {
          if (chain[0] === 'this' || localType(arg, chain[0]!) !== undefined) continue; // variável local, não função
          results.push({ caller, name: chain[0]!, kind: 'ref' });
        } else {
          const object = chain.slice(0, -1);
          results.push({ caller, name: chain.at(-1)!, object, kind: 'ref', ...receiverOf(arg, object) });
        }
      }
    }
  });
  return results;
}
