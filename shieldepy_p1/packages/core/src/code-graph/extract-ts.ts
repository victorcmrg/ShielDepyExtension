// Leitura da árvore Tree-sitter de um arquivo TS/JS: símbolos, chamadas e referências.
// Funções puras — não sabem nada do grafo; o CodeGraph decide o que fazer com o resultado.
// Tudo aqui é lido da AST: nada de regex sobre o texto do código.

import { constructedType, FUNCTION_VALUE_TYPES, memberChain, typeRef, walk, type TypeRef } from './ast';
import { DEFAULT_EXPORT_NAME, propertyKey } from './extract-module';
import type { SyntaxNode } from './parser';
import { bodyHash } from './fingerprint';
import type { CallArg, SymbolKind } from './types';

export type { TypeRef } from './ast';

export interface SymbolInfo {
  id: string;
  kind: SymbolKind;
  name: string;
  startLine: number;
  endLine: number;
  /** Lista de parâmetros (texto literal, ex: "(a: string, b: number)"). */
  signature?: string;
  /** Hash do corpo pela AST (sem comentários, espaço e o próprio nome): o diff entre mapas (E5) vê se ele mudou. */
  bodyHash: string;
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
  /** Função/método: tipo de retorno anotado (`Promise<T>` desembrulhado pra T). */
  returns?: TypeRef;
}

/**
 * O que se sabe estaticamente sobre o receptor de `obj.m()`:
 * `type` é o tipo da parte inicial da cadeia; `rest` são as propriedades que ainda faltam
 * percorrer até o método (`this.deps.repo.save()` com `deps: Deps` → type Deps, rest ['repo']).
 */
export type Receiver =
  | { type: TypeRef; rest: string[] }
  /** O receptor é o RESULTADO de outra chamada: `res.status(400).json()`, `const r = Router(); r.post()`. */
  | { call: CallDesc; rest: string[] };

/** Uma chamada sem o chamador — o mesmo formato serve pro receptor de outra chamada. */
export type CallDesc = Omit<RawCall, 'caller' | 'kind' | 'symbolId'>;

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
  /** O receptor é uma expressão que não dá pra seguir (`a[0].b()`): só o fallback por nome do MÉTODO serve. */
  dynamic?: boolean;
  /** `ref`: função passada como valor (`app.post('/x', handler)`), vira aresta `references`. */
  kind?: 'call' | 'ref';
  /** Referência a um símbolo já conhecido (callback anônimo que virou símbolo). */
  symbolId?: string;
  /** Início da chamada (0-based) e o offset do FIM: em `a(b())` e `x.f().g()` o de dentro termina (e roda) antes. */
  line?: number;
  column?: number;
  end?: number;
  args?: RawArg[];
  /** Onde a raiz do receptor (ou o nome chamado) é declarada: topo do arquivo ou dentro do chamador. */
  scope?: Scope;
  /** `require('x')` com o especificador literal: o valor é o módulo `x` (`require('express').Router()`). */
  spec?: string;
  /**
   * Receptor que é o resultado de uma cadeia (`Router().use(a).use(b)`): quem guarda a cadeia
   * inteira (`const api = ...` → `api`; `export default ...` → `default`) ou, solta, a posição
   * da chamada que a começa (`@linha:coluna`). Dá ao valor sem nome a mesma identidade que um
   * nome teria — sem isso o roteador montado assim não existia.
   */
  chainRoot?: { name: string; scope?: Scope };
}

/** `module`: declarado no topo do arquivo; `local`: parâmetro ou variável de uma função. */
export type Scope = 'module' | 'local';

/** Argumento como sai do parse; o `name` o CodeGraph resolve depois (vira `CallArg`). */
export type RawArg =
  | Exclude<CallArg, { kind: 'name' | 'call' }>
  | { kind: 'name'; chain: string[]; ref: CallDesc; scope?: Scope }
  | { kind: 'call'; callee: string[]; spec?: string };

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

/** `require('x')` → 'x' (só com o especificador literal). */
function requireSpecOf(node: SyntaxNode): string | undefined {
  if (!isRequire(node)) return undefined;
  const first = node.childForFieldName('arguments')?.namedChildren[0];
  return first?.type === 'string' ? unquote(first.text) : undefined;
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
 * Tipo de retorno anotado de uma função; `Promise<T>` vira T (quem usa o valor faz `await`).
 * Retorno anotado mas não nominal (`string`, `X[]`) → `[]`: sabe-se que não é classe do projeto.
 */
function returnType(fn: SyntaxNode): TypeRef | undefined {
  const annotation = fn.childForFieldName('return_type');
  if (!annotation) return undefined;
  let inner: SyntaxNode | null | undefined = annotation.type === 'type_annotation' ? annotation.namedChildren[0] : annotation;
  if (inner?.type === 'generic_type' && inner.childForFieldName('name')?.text === 'Promise') {
    const args = inner.childForFieldName('type_arguments') ?? inner.namedChildren.find((c) => c.type === 'type_arguments');
    inner = args?.namedChildren[0] ?? null;
  }
  return typeRef(inner) ?? [];
}

function unwrap(node: SyntaxNode | null | undefined): SyntaxNode | null | undefined {
  let n = node;
  while (n && (n.type === 'await_expression' || n.type === 'parenthesized_expression' || n.type === 'non_null_expression')) {
    n = n.namedChildren[0];
  }
  return n;
}

type LocalType = TypeRef | null | 'opaque' | { call: CallDesc } | undefined;

/**
 * Tipo de uma variável/parâmetro visível em `from`, procurando nos escopos de dentro pra fora.
 * `undefined` = não é local (pode ser import ou global); `null` = é local mas sem tipo conhecido;
 * `'opaque'` = é local e de tipo nativo/estrutural; `{ call }` = valor de retorno de uma chamada.
 */
function localType(from: SyntaxNode, name: string): LocalType {
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
          // `const x = x.foo()` — a própria declaração: sem isso a descrição da chamada entra em laço
          if (from.startIndex >= d.startIndex && from.endIndex <= d.endIndex) return null;
          const value = d.childForFieldName('value');
          // `const f = () => {}` é símbolo, `const o = { m() {} }` tem métodos e `require()` é import: o grafo resolve
          if (value && (FUNCTION_VALUE_TYPES.has(value.type) || value.type === 'object' || isRequire(value))) return undefined;
          const annotated = annotatedType(d.childForFieldName('type'));
          if (annotated !== null) return annotated;
          if (value && OPAQUE_VALUE_TYPES.has(value.type)) return 'opaque';
          const constructed = constructedType(value);
          if (constructed) return constructed;
          const inner = unwrap(value);
          const call = inner?.type === 'call_expression' ? describeCall(inner) : undefined;
          return call ? { call } : null;
        }
      }
    }
  }
  return undefined;
}

function receiverOf(node: SyntaxNode, chain: string[]): Pick<CallDesc, 'receiver' | 'shadowed' | 'opaque'> {
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
  if (t && !Array.isArray(t)) return { receiver: { call: t.call, rest } };
  return t ? { receiver: { type: t, rest } } : {};
}

/** Descreve uma chamada (`f()`, `a.b.c()`, `x().y()`, `new X()`) do jeito que o grafo resolve. */
function describeCall(node: SyntaxNode): CallDesc | undefined {
  const fn = node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor');
  if (fn?.type === 'identifier') {
    const local = localType(node, fn.text);
    if (local !== undefined && (local === null || !Array.isArray(local))) return { name: fn.text, shadowed: true };
    const spec = requireSpecOf(node);
    return { name: fn.text, ...(spec !== undefined && { spec }) };
  }
  if (fn?.type !== 'member_expression') return undefined;
  const name = fn.childForFieldName('property')?.text;
  if (!name) return undefined;
  const objectNode = fn.childForFieldName('object');
  const object = memberChain(objectNode);
  if (object) return { name, object, ...receiverOf(node, object) };
  // `res.status(400).json()` / `(await repo.find()).map()` — o receptor é o resultado de outra chamada
  const inner = unwrap(objectNode);
  const innerCall = inner?.type === 'call_expression' || inner?.type === 'new_expression' ? describeCall(inner) : undefined;
  return innerCall ? { name, receiver: { call: innerCall, rest: [] } } : { name, dynamic: true };
}

/** O nome é declarado neste bloco (`const`/`let`/`var`, inclusive exportado)? `require()` é import, não valor local. */
function declaresIn(block: SyntaxNode, name: string): boolean {
  for (const stmt of block.namedChildren) {
    const decl = stmt.type === 'export_statement' ? stmt.childForFieldName('declaration') : stmt;
    if (decl?.type !== 'lexical_declaration' && decl?.type !== 'variable_declaration') continue;
    for (const d of decl.namedChildren) {
      if (d.type !== 'variable_declarator' || d.childForFieldName('name')?.text !== name) continue;
      const value = d.childForFieldName('value');
      return !(value && isRequire(value));
    }
  }
  return false;
}

/** Onde `name`, visto de `from`, é declarado: topo do arquivo, dentro de uma função, ou fora daqui (import/global). */
function declarationScope(from: SyntaxNode, name: string): Scope | undefined {
  for (let n = from.parent; n; n = n.parent) {
    if (FUNCTION_SCOPE_TYPES.has(n.type)) {
      const single = n.childForFieldName('parameter');
      if (single?.type === 'identifier' && single.text === name) return 'local';
      if ((n.childForFieldName('parameters')?.namedChildren ?? []).some((p) => paramName(p) === name)) return 'local';
    }
    if (BLOCK_TYPES.has(n.type) && declaresIn(n, name)) return n.type === 'program' ? 'module' : 'local';
  }
  return undefined;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0' };

/** Conteúdo de um literal de string sem as aspas, com os escapes simples desfeitos. */
function unquote(raw: string): string {
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i]!;
    if (c !== '\\' || i + 1 >= raw.length - 1) out += c;
    else out += ESCAPES[raw[++i]!] ?? raw[i];
  }
  return out;
}

/** Texto literal: string inteira, ou o começo de um template até a 1ª substituição. */
function describeText(node: SyntaxNode): { kind: 'string'; value: string } | { kind: 'template'; prefix: string } | undefined {
  if (node.type === 'string') return { kind: 'string', value: unquote(node.text) };
  if (node.type !== 'template_string') return undefined;
  const sub = node.namedChildren.find((c) => c.type === 'template_substitution');
  if (!sub) return { kind: 'string', value: unquote(node.text) };
  return { kind: 'template', prefix: unquote(node.text.slice(0, sub.startIndex - node.startIndex) + '`') };
}

/** O que dá pra saber de um argumento sem executar nada. */
function describeArg(arg: SyntaxNode, symbolAt: Map<number, SymbolInfo>): RawArg {
  const text = describeText(arg);
  if (text) return text;
  if (arg.type === 'object') {
    const keys: string[] = [];
    const texts: Record<string, { kind: 'string'; value: string } | { kind: 'template'; prefix: string }> = {};
    for (const p of arg.namedChildren) {
      if (p.type === 'shorthand_property_identifier') keys.push(p.text);
      else if (p.type === 'spread_element') keys.push('...');
      else {
        const keyNode = p.childForFieldName('key') ?? p.childForFieldName('name');
        const key = keyNode?.type === 'string' ? unquote(keyNode.text) : keyNode?.text ?? '';
        if (key === '') continue;
        keys.push(key);
        const value = p.type === 'pair' ? p.childForFieldName('value') : undefined;
        const t = value ? describeText(value) : undefined;
        if (t) texts[key] = t;
      }
    }
    return { kind: 'object', keys, ...(Object.keys(texts).length > 0 && { texts }) };
  }
  if (FUNCTION_VALUE_TYPES.has(arg.type)) {
    const symbolId = symbolAt.get(arg.startIndex)?.id;
    return symbolId ? { kind: 'function', symbolId } : { kind: 'function' };
  }
  if (arg.type === 'call_expression') {
    const callee = memberChain(arg.childForFieldName('function'));
    const spec = requireSpecOf(arg);
    if (callee) return { kind: 'call', callee, ...(spec !== undefined && { spec }) };
  }
  const chain = memberChain(arg);
  if (!chain || chain[0] === 'super' || (chain.length === 1 && chain[0] === 'this')) return { kind: 'other' };
  const scope = chain[0] === 'this' ? undefined : declarationScope(arg, chain[0]!);
  const ref: CallDesc =
    chain.length === 1
      ? { name: chain[0]!, ...(localType(arg, chain[0]!) !== undefined ? { shadowed: true } : {}) }
      : { name: chain.at(-1)!, object: chain.slice(0, -1), ...receiverOf(arg, chain.slice(0, -1)) };
  return { kind: 'name', chain, ref, ...(scope && { scope }) };
}

/**
 * Nome de um objeto literal: `const repo = {…}` → `repo`; `export default {…}` → `default`;
 * aninhado (`export default { invariants: {…} }`) → `default.invariants`.
 */
function objectPath(object: SyntaxNode): string | undefined {
  const holder = object.parent;
  if (holder?.type === 'variable_declarator') {
    const name = holder.childForFieldName('name');
    return name?.type === 'identifier' ? name.text : undefined;
  }
  if (holder?.type === 'export_statement') return DEFAULT_EXPORT_NAME;
  if (holder?.type === 'pair' && holder.parent?.type === 'object') {
    const base = objectPath(holder.parent);
    const key = propertyKey(holder.childForFieldName('key'));
    return base && key ? `${base}.${key}` : undefined;
  }
  return undefined;
}

/** Nome do contêiner de um método: classe, ou o caminho do objeto literal que o guarda. */
function containerOf(node: SyntaxNode): string | undefined {
  const parent = node.parent;
  if (parent?.type === 'class_body' && parent.parent) return className(parent.parent);
  return parent?.type === 'object' ? objectPath(parent) : undefined;
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
      id: '', // atribuído no fim: ver `stableIds`
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: paramsNode?.text,
      // o nó hasheado é a função; quando ela é o próprio nó do símbolo (método, classe), o nome sai
      bodyHash: bodyHash(fn, fn.startIndex === node.startIndex && fn.type === node.type ? node.childForFieldName('name') : undefined),
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
      if (node.type === 'method_definition') push(node, 'method', name, node, { container: containerOf(node), returns: returnType(node) });
      else push(node, 'function', name, node, { returns: returnType(node) });
    } else if (node.type === 'variable_declarator' || node.type === 'public_field_definition' || node.type === 'pair') {
      // `const f = () => {}`, campo `handle = () => {}`, e `{ find: async () => {} }` em objeto literal
      const value = node.childForFieldName('value');
      // chave entre aspas (`'with-dash': () => {}`) vira o nome sem as aspas
      const name = node.type === 'pair' ? propertyKey(node.childForFieldName('key')) : node.childForFieldName('name')?.text;
      if (name && value && FUNCTION_VALUE_TYPES.has(value.type)) {
        if (node.type === 'variable_declarator') push(node, 'function', name, value, { returns: returnType(value) });
        else push(node, 'method', name, value, { container: containerOf(node), returns: returnType(value) });
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

  stableIds(results, fileId);
  return results;
}

/**
 * Id estável: `arquivo#Contêiner.nome`, sem a linha — inserir linhas acima de uma função não pode
 * mudar a identidade dela (o diff entre dois mapas dependeria disso). Nomes repetidos no mesmo
 * arquivo (callbacks inline iguais, `const f` em funções diferentes) ganham `~2`, `~3` pela
 * ordem no arquivo. A linha continua em `startLine`.
 */
function stableIds(symbols: SymbolInfo[], fileId: string): void {
  const seen = new Map<string, number>();
  for (const s of [...symbols].sort((a, b) => a.startIndex - b.startIndex)) {
    const base = `${fileId}#${s.container ? `${s.container}.${s.name}` : s.name}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    s.id = n === 1 ? base : `${base}~${n}`;
  }
}

/** Quem guarda a cadeia de chamadas de que `node` faz parte (ver `RawCall.chainRoot`). */
function chainRootOf(node: SyntaxNode): RawCall['chainRoot'] {
  // a chamada que começa a cadeia: `Router()` em `Router().use(a).use(b)`
  let root = node;
  for (;;) {
    const fn = root.childForFieldName('function');
    const inner = fn?.type === 'member_expression' ? unwrap(fn.childForFieldName('object')) : undefined;
    if (inner?.type !== 'call_expression' && inner?.type !== 'new_expression') break;
    root = inner;
  }
  // o fim da cadeia: sobe enquanto o valor for o receptor de mais uma chamada
  let top = node;
  while (top.parent?.type === 'member_expression' && top.parent.parent?.type === 'call_expression') top = top.parent.parent;
  const holder = top.parent;
  if (holder?.type === 'variable_declarator' && holder.childForFieldName('value')?.startIndex === top.startIndex) {
    const name = holder.childForFieldName('name');
    if (name?.type === 'identifier') {
      const scope = declarationScope(top, name.text);
      return { name: name.text, ...(scope && { scope }) };
    }
  }
  if (holder?.type === 'export_statement' && holder.children.some((c) => c.type === 'default')) return { name: DEFAULT_EXPORT_NAME, scope: 'module' };
  return { name: `@${root.startPosition.row}:${root.startPosition.column}`, scope: 'module' };
}

/**
 * Chamadas, cada uma atribuída ao símbolo MAIS INTERNO que a contém (método, não a classe), com o
 * tipo do receptor quando o arquivo deixa saber, a posição e os argumentos estáticos. Chamada no
 * topo do arquivo (`router.post('/x', ...)`) fica com o próprio arquivo (`fileId`) como chamador.
 * Também as referências: função passada como argumento (`router.use(auth)`, `app.post('/x', ctrl.create)`),
 * atribuídas ao símbolo envolvente ou, no topo do arquivo, ao próprio arquivo.
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
      const caller = enclosing(node.startIndex) ?? fileId;
      const desc = caller ? describeCall(node) : undefined;
      if (!caller || !desc) return;
      const root = desc.object?.[0] ?? desc.name;
      const scope = root === 'this' || root === 'super' ? undefined : declarationScope(node, root);
      const args = node.childForFieldName('arguments')?.namedChildren.filter((a) => a.type !== 'comment') ?? [];
      const chainRoot = !desc.object && desc.receiver && 'call' in desc.receiver ? chainRootOf(node) : undefined;
      results.push({
        caller,
        ...desc,
        ...(chainRoot && { chainRoot }),
        line: node.startPosition.row,
        column: node.startPosition.column,
        end: node.endIndex,
        args: args.map((a) => describeArg(a, symbolAt)),
        ...(scope && { scope }),
      });
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
