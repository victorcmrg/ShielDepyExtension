// Leitura da árvore Tree-sitter de um arquivo C#: símbolos (classes, structs, records, métodos,
// construtores, funções locais e os callbacks de endpoint), o namespace de cada classe, as chamadas
// com o tipo do receptor e os atributos (que viram chamadas `decorates`, como os decorators do TS).
// Etapa L do plano. Funções puras, sem regex: tudo vem dos nós da AST.
//
// O C# não importa arquivos: `using App.Services;` torna visíveis os tipos de um namespace, que se
// espalha por vários arquivos. Por isso o arquivo devolve o seu `NamespaceScope` e o CodeGraph
// resolve os nomes de tipo por um índice de classes (ver `CodeGraph.resolveScopedType`).

import type { ImportBinding, ModuleInfo } from './extract-module';
import { stableIds, type CallDesc, type RawArg, type RawCall, type Scope, type SymbolInfo, type TypeRef } from './extract-ts';
import { bodyHash, topLevelHash } from './fingerprint';
import type { FileExtraction, NamespaceScope } from './frontend';
import type { SyntaxNode } from './parser';
import type { SymbolKind } from './types';

const EF = 'Microsoft.EntityFrameworkCore';
const HTTP = 'System.Net.Http';
const MVC = 'Microsoft.AspNetCore.Mvc';
const BUILDER = 'Microsoft.AspNetCore.Builder';
const ROUTING = 'Microsoft.AspNetCore.Routing';

/**
 * Tipos de fora do projeto que importam para o mapa e para o caos, pelo nome simples → o "pacote".
 * Sem o compilador não há como saber de onde vem um tipo qualquer; estes são os que a topologia
 * reconhece (banco, HTTP, rotas). O resto (`string`, `List`, `Task`, LINQ, `ILogger`) é nativo:
 * não é código do projeto e não conta na cobertura. Um tipo do projeto com o mesmo nome vence.
 */
export const CSHARP_EXTERNAL_TYPES: Readonly<Record<string, string>> = {
  DbContext: EF,
  DbSet: EF,
  DatabaseFacade: EF,
  IDbContextTransaction: EF,
  HttpClient: HTTP,
  IHttpClientFactory: HTTP,
  ControllerBase: MVC,
  Controller: MVC,
  ApiController: MVC,
  Route: MVC,
  HttpGet: MVC,
  HttpPost: MVC,
  HttpPut: MVC,
  HttpPatch: MVC,
  HttpDelete: MVC,
  HttpHead: MVC,
  HttpOptions: MVC,
  WebApplication: BUILDER,
  WebApplicationBuilder: BUILDER,
  IApplicationBuilder: BUILDER,
  IEndpointRouteBuilder: ROUTING,
  RouteGroupBuilder: ROUTING,
  IDbConnection: 'System.Data',
  IDbTransaction: 'System.Data',
  DbConnection: 'System.Data',
  SqlConnection: 'Microsoft.Data.SqlClient',
  NpgsqlConnection: 'Npgsql',
  NpgsqlDataSource: 'Npgsql',
  MySqlConnection: 'MySqlConnector',
  SqliteConnection: 'Microsoft.Data.Sqlite',
};

const CLASS_TYPES = new Set(['class_declaration', 'struct_declaration', 'record_declaration', 'record_struct_declaration']);
const TYPE_DECLARATIONS = new Set([...CLASS_TYPES, 'interface_declaration', 'enum_declaration', 'delegate_declaration']);
/** Onde nascem parâmetros e variáveis locais. */
const FUNCTION_TYPES = new Set([
  'method_declaration',
  'constructor_declaration',
  'local_function_statement',
  'lambda_expression',
  'anonymous_method_expression',
  'accessor_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
]);
const LAMBDA_TYPES = new Set(['lambda_expression', 'anonymous_method_expression']);
/** Valores de tipo nativo: chamar algo neles nunca é código do projeto. */
const OPAQUE_VALUES = new Set([
  'string_literal',
  'verbatim_string_literal',
  'raw_string_literal',
  'interpolated_string_expression',
  'integer_literal',
  'real_literal',
  'boolean_literal',
  'character_literal',
  'array_creation_expression',
  'implicit_array_creation_expression',
]);
/** Tipos de tarefa: quem usa o valor faz `await`, então o retorno é o tipo de dentro. */
const TASK_TYPES = new Set(['Task', 'ValueTask']);
/** Endpoints das minimal APIs: o callback passado vira símbolo (é o handler da rota). */
const ENDPOINT_MAPPERS = new Set(['MapGet', 'MapPost', 'MapPut', 'MapPatch', 'MapDelete', 'MapMethods']);

// ---------------------------------------------------------------------------------------------
// Tipos e nomes

/** `Repo` → ['Repo'], `App.Data.Repo` → ['App','Data','Repo'], `Repo<X>` → ['Repo'], `Repo?` → ['Repo']. */
export function csType(node: SyntaxNode | null | undefined): TypeRef | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'identifier':
      return [node.text];
    case 'generic_name':
      return node.namedChildren[0]?.type === 'identifier' ? [node.namedChildren[0].text] : undefined;
    case 'qualified_name':
      return node.namedChildren.flatMap((c) => csType(c) ?? []);
    case 'alias_qualified_name':
      // `global::App.Repo`: o que vem depois do `::`
      return csType(node.namedChildren.at(-1));
    case 'nullable_type':
      return csType(node.namedChildren[0]);
    default:
      return undefined;
  }
}

/** `DbSet<Order>` → `Order` (o 1º argumento de tipo, quando é um nome). */
function firstTypeArg(node: SyntaxNode | null | undefined): string | undefined {
  const generic = node?.type === 'qualified_name' ? node.namedChildren.at(-1) : node?.type === 'nullable_type' ? node.namedChildren[0] : node;
  if (generic?.type !== 'generic_name') return undefined;
  const args = generic.namedChildren.find((c) => c.type === 'type_argument_list');
  return csType(args?.namedChildren[0])?.at(-1);
}

/** Tipo de retorno de um método: `Task<T>`/`ValueTask<T>` viram T; `void`, nativos e coleções viram `[]` (não é classe do projeto). */
function returnType(type: SyntaxNode | null | undefined): TypeRef | undefined {
  if (!type) return undefined;
  if (type.type === 'generic_name') {
    const name = type.namedChildren[0]?.text;
    const args = type.namedChildren.find((c) => c.type === 'type_argument_list');
    if (name && TASK_TYPES.has(name)) return returnType(args?.namedChildren[0]);
    return [];
  }
  if (type.type === 'identifier' && TASK_TYPES.has(type.text)) return [];
  return csType(type) ?? [];
}

/** Atributo `HttpGetAttribute` → `HttpGet` (o C# aceita os dois). */
function attributeName(name: string): string {
  return name.length > 'Attribute'.length && name.endsWith('Attribute') ? name.slice(0, -'Attribute'.length) : name;
}

function qualifiedText(node: SyntaxNode | null | undefined): string | undefined {
  return csType(node)?.join('.');
}

// ---------------------------------------------------------------------------------------------
// Texto literal

/** `"a\"b"` → `a"b`; `@"a""b"` → `a"b`; `"""x"""` → `x`. */
function literalText(node: SyntaxNode): string | undefined {
  const raw = node.text;
  if (node.type === 'verbatim_string_literal') return raw.slice(2, -1).split('""').join('"');
  if (node.type === 'raw_string_literal') {
    let q = 0;
    while (raw[q] === '"') q++;
    return raw.slice(q, raw.length - q);
  }
  if (node.type !== 'string_literal') return undefined;
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i]!;
    if (c !== '\\' || i + 1 >= raw.length - 1) out += c;
    else out += ESCAPES[raw[++i]!] ?? raw[i];
  }
  return out;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0' };

/** Texto estático de um argumento: string inteira, ou o começo de `$"..."` até a 1ª interpolação. */
function describeText(node: SyntaxNode): { kind: 'string'; value: string } | { kind: 'template'; prefix: string } | undefined {
  const text = literalText(node);
  if (text !== undefined) return { kind: 'string', value: text };
  if (node.type !== 'interpolated_string_expression') return undefined;
  const open = node.children[0];
  const start = open ? open.endIndex - node.startIndex : 0;
  const interp = node.namedChildren.find((c) => c.type === 'interpolation');
  const end = interp ? interp.startIndex - node.startIndex : node.text.length - 1;
  const literal = node.text.slice(start, end).split('{{').join('{').split('}}').join('}');
  return interp ? { kind: 'template', prefix: literal } : { kind: 'string', value: literal };
}

// ---------------------------------------------------------------------------------------------
// Namespaces e classes

function namespaceName(node: SyntaxNode): string | undefined {
  return qualifiedText(node.childForFieldName('name'));
}

/** Namespace de uma declaração: os `namespace X { }` em volta e o `namespace X;` do arquivo. */
function namespaceOf(node: SyntaxNode, fileScoped: string | undefined): string {
  const parts: string[] = [];
  for (let n = node.parent; n; n = n.parent) {
    if (n.type === 'namespace_declaration') {
      const name = namespaceName(n);
      if (name) parts.unshift(name);
    }
  }
  if (fileScoped) parts.unshift(fileScoped);
  return parts.join('.');
}

/** `A.B.C` → `A.B.C`, `A.B`, `A` (no C#, um namespace enxerga os de cima sem `using`). */
function withParents(ns: string): string[] {
  const out: string[] = [];
  for (let s = ns; s; s = s.includes('.') ? s.slice(0, s.lastIndexOf('.')) : '') out.push(s);
  return out;
}

function namespaceScope(root: SyntaxNode): { scope: NamespaceScope; fileScoped?: string } {
  const visible = new Set<string>();
  const aliases: Record<string, string> = {};
  const global: string[] = [];
  let fileScoped: string | undefined;
  walk(root, (n) => {
    if (n.type === 'file_scoped_namespace_declaration') {
      fileScoped = namespaceName(n);
      if (fileScoped) for (const ns of withParents(fileScoped)) visible.add(ns);
    } else if (n.type === 'namespace_declaration') {
      // o nome completo inclui os `namespace X { }` em volta: `namespaceOf` do próprio nome sobe por eles
      const own = namespaceOf(n.childForFieldName('name') ?? n, undefined);
      for (const v of withParents(own)) visible.add(v);
    } else if (n.type === 'using_directive') {
      // `using static X.Y;` abre os membros de um tipo, não um namespace: fica de fora
      if (n.children.some((c) => c.type === 'static')) return false;
      const alias = n.namedChildren.find((c) => c.type === 'name_equals');
      const target = qualifiedText(n.namedChildren.find((c) => c.type !== 'name_equals'));
      if (!target) return false;
      if (alias) aliases[alias.namedChildren[0]?.text ?? ''] = target;
      else {
        visible.add(target);
        if (n.children.some((c) => c.type === 'global')) global.push(target);
      }
      return false;
    }
    return !TYPE_DECLARATIONS.has(n.type);
  });
  delete aliases[''];
  return { scope: { visible: [...visible].sort(), aliases, ...(global.length > 0 && { global: global.sort() }) }, fileScoped };
}

function className(cls: SyntaxNode): string {
  return cls.childForFieldName('name')?.text ?? '<anônima>';
}

function enclosingClass(node: SyntaxNode): SyntaxNode | undefined {
  for (let n = node.parent; n; n = n.parent) if (CLASS_TYPES.has(n.type)) return n;
  return undefined;
}

/** Os tipos da lista de bases (`: Base<X>, IFoo`), sem os argumentos do construtor-base dos records. */
function baseTypes(cls: SyntaxNode): SyntaxNode[] {
  const list = cls.childForFieldName('bases') ?? cls.namedChildren.find((c) => c.type === 'base_list');
  return (list?.namedChildren ?? []).filter((c) => c.type !== 'argument_list');
}

interface ClassShape {
  fields: Record<string, TypeRef>;
  fieldArgs: Record<string, string>;
  properties: string[];
}

function declarators(declaration: SyntaxNode | undefined): Array<{ name: string; value?: SyntaxNode }> {
  return (declaration?.namedChildren ?? [])
    .filter((d) => d.type === 'variable_declarator')
    .flatMap((d) => {
      const id = d.childForFieldName('name') ?? d.namedChildren.find((c) => c.type === 'identifier');
      const clause = d.namedChildren.find((c) => c.type === 'equals_value_clause');
      return id ? [{ name: id.text, value: clause?.namedChildren[0] }] : [];
    });
}

/** Campos e propriedades de uma classe, com o tipo (o que permite seguir `_repo.Save()` e `_db.Orders.Add()`). */
function classShape(cls: SyntaxNode): ClassShape {
  const fields: Record<string, TypeRef> = {};
  const fieldArgs: Record<string, string> = {};
  const properties = new Set<string>();
  const add = (name: string, type: SyntaxNode | null | undefined, value?: SyntaxNode) => {
    properties.add(name);
    const t = csType(type) ?? (value?.type === 'object_creation_expression' ? csType(value.childForFieldName('type')) : undefined);
    if (t && !fields[name]) fields[name] = t;
    const arg = firstTypeArg(type);
    if (arg && !fieldArgs[name]) fieldArgs[name] = arg;
  };
  // record com parâmetros: `record Order(int Id, Customer Customer)` — cada parâmetro é uma propriedade
  for (const p of cls.childForFieldName('parameters')?.namedChildren ?? []) {
    const name = p.childForFieldName('name')?.text;
    if (p.type === 'parameter' && name) add(name, p.childForFieldName('type'));
  }
  for (const member of cls.childForFieldName('body')?.namedChildren ?? []) {
    if (member.type === 'field_declaration') {
      const decl = member.namedChildren.find((c) => c.type === 'variable_declaration');
      for (const d of declarators(decl)) add(d.name, decl?.childForFieldName('type'), d.value);
    } else if (member.type === 'property_declaration') {
      const name = member.childForFieldName('name')?.text;
      if (name) add(name, member.childForFieldName('type'));
    } else if (member.type === 'constructor_declaration') {
      // injeção pelo construtor: `_db = db;` / `this.db = db;` com `db` parâmetro tipado
      const params = new Map<string, SyntaxNode>();
      for (const p of member.childForFieldName('parameters')?.namedChildren ?? []) {
        const name = p.childForFieldName('name')?.text;
        const type = p.childForFieldName('type');
        if (name && type) params.set(name, type);
      }
      walk(member.childForFieldName('body') ?? member, (n) => {
        if (n.type !== 'assignment_expression') return;
        const left = n.childForFieldName('left');
        const field = left?.type === 'identifier' ? left.text : left?.type === 'member_access_expression' && left.childForFieldName('expression')?.type === 'this_expression' ? left.childForFieldName('name')?.text : undefined;
        const right = n.childForFieldName('right');
        if (!field) return;
        properties.add(field);
        if (right?.type === 'identifier' && params.has(right.text)) add(field, params.get(right.text));
        else if (right?.type === 'object_creation_expression') add(field, right.childForFieldName('type'));
      });
    }
  }
  return { fields, fieldArgs, properties: [...properties] };
}

// ---------------------------------------------------------------------------------------------
// Variáveis locais

/** O que se sabe de uma variável: tipo nominal, `opaque` (nativo), `{ call }` (retorno de chamada) ou `null` (sem tipo). */
type LocalType = TypeRef | null | 'opaque' | { call: CallDesc };

function typeOfDeclared(type: SyntaxNode | null | undefined, value: SyntaxNode | undefined): LocalType {
  if (type && type.type !== 'implicit_type') {
    if (type.type === 'predefined_type' || type.type === 'array_type' || type.type === 'tuple_type') return 'opaque';
    return csType(type) ?? null;
  }
  return value ? valueType(value) : null;
}

/** Tipo do valor de `var x = <valor>`. */
function valueType(value: SyntaxNode): LocalType {
  let v: SyntaxNode | null | undefined = value;
  while (v && (v.type === 'await_expression' || v.type === 'parenthesized_expression')) v = v.namedChildren[0];
  if (!v) return null;
  if (OPAQUE_VALUES.has(v.type)) return 'opaque';
  if (v.type === 'object_creation_expression') return csType(v.childForFieldName('type')) ?? null;
  if (v.type === 'cast_expression') return csType(v.childForFieldName('type')) ?? null;
  if (v.type === 'as_expression') return csType(v.childForFieldName('right')) ?? null;
  if (v.type === 'invocation_expression') {
    const desc = describeInvocation(v);
    return desc ? { call: withArgs(v, desc) } : null;
  }
  return null;
}

/** `name` como parâmetro de uma função/lambda: o tipo (ou `null` sem tipo). `undefined` = não é parâmetro dela. */
function paramIn(fn: SyntaxNode, name: string): LocalType | undefined {
  // lambda de um parâmetro sem parênteses: `x => ...`
  const single = fn.namedChildren.find((c) => c.type === 'identifier');
  if (LAMBDA_TYPES.has(fn.type) && single?.text === name && !fn.childForFieldName('parameters')) return null;
  const list = fn.childForFieldName('parameters') ?? fn.namedChildren.find((c) => c.type === 'parameter_list');
  for (const p of list?.namedChildren ?? []) {
    if (p.childForFieldName('name')?.text !== name) continue;
    return typeOfDeclared(p.childForFieldName('type'), undefined);
  }
  return undefined;
}

/** Variável `name` declarada num bloco (ou nos comandos de topo do arquivo). */
function declaredIn(block: SyntaxNode, name: string, from: SyntaxNode): LocalType | undefined {
  for (const raw of block.namedChildren) {
    const stmt = raw.type === 'global_statement' ? raw.namedChildren[0] : raw;
    if (stmt?.type !== 'local_declaration_statement') continue;
    const decl = stmt.namedChildren.find((c) => c.type === 'variable_declaration');
    for (const d of declarators(decl)) {
      if (d.name !== name) continue;
      // `var x = x.Foo()` — a própria declaração
      if (d.value && from.startIndex >= d.value.startIndex && from.endIndex <= d.value.endIndex) return null;
      return typeOfDeclared(decl?.childForFieldName('type'), d.value);
    }
  }
  return undefined;
}

interface Local {
  type: LocalType;
  scope: Scope;
}

/** A variável `name` vista de `from`, de dentro pra fora. `undefined` = não é local (campo, tipo ou global). */
function localOf(from: SyntaxNode, name: string): Local | undefined {
  for (let n = from.parent; n; n = n.parent) {
    if (FUNCTION_TYPES.has(n.type)) {
      const t = paramIn(n, name);
      if (t !== undefined) return { type: t, scope: 'local' };
    }
    if (n.type === 'block' || n.type === 'switch_section') {
      const t = declaredIn(n, name, from);
      if (t !== undefined) return { type: t, scope: 'local' };
    }
    if (n.type === 'compilation_unit') {
      const t = declaredIn(n, name, from);
      if (t !== undefined) return { type: t, scope: 'module' };
    }
    if (n.type === 'foreach_statement') {
      const left = n.childForFieldName('left');
      if (left?.text === name) return { type: typeOfDeclared(n.childForFieldName('type'), undefined), scope: 'local' };
    }
    if (n.type === 'for_statement' || n.type === 'using_statement' || n.type === 'fixed_statement') {
      const decl = n.namedChildren.find((c) => c.type === 'variable_declaration');
      const d = declarators(decl).find((x) => x.name === name);
      if (d) return { type: typeOfDeclared(decl?.childForFieldName('type'), d.value), scope: 'local' };
    }
    if (n.type === 'catch_clause') {
      const decl = n.namedChildren.find((c) => c.type === 'catch_declaration');
      if (decl?.childForFieldName('name')?.text === name) return { type: csType(decl.childForFieldName('type')) ?? null, scope: 'local' };
    }
    // `is Order o` / `out var x`: declarada numa expressão — sem o tipo, mas é local
    if (n.type === 'block' || n.type === 'compilation_unit') {
      let found = false;
      walk(n, (x) => {
        if (found) return false;
        if ((x.type === 'declaration_pattern' || x.type === 'declaration_expression') && designation(x) === name) found = true;
        return !FUNCTION_TYPES.has(x.type) || x.startIndex === n.startIndex;
      });
      if (found) return { type: null, scope: n.type === 'compilation_unit' ? 'module' : 'local' };
    }
    if (CLASS_TYPES.has(n.type)) return undefined;
  }
  return undefined;
}

function designation(node: SyntaxNode): string | undefined {
  const d = node.childForFieldName('designation') ?? node.childForFieldName('name') ?? node.namedChildren.at(-1);
  return d?.type === 'identifier' ? d.text : d?.type === 'single_variable_designation' ? d.text : undefined;
}

/** A função local `name` está em escopo em `from` (declarada num bloco em volta)? */
function localFunction(from: SyntaxNode, name: string): boolean {
  for (let n = from.parent; n; n = n.parent) {
    if (n.type === 'block' || n.type === 'compilation_unit') {
      for (const raw of n.namedChildren) {
        const stmt = raw.type === 'global_statement' ? raw.namedChildren[0] : raw;
        if (stmt?.type === 'local_function_statement' && stmt.childForFieldName('name')?.text === name) return true;
      }
    }
    if (CLASS_TYPES.has(n.type)) return false;
  }
  return false;
}

function shapeOf(cls: SyntaxNode, cache: Map<number, ClassShape>): ClassShape {
  let shape = cache.get(cls.startIndex);
  if (!shape) cache.set(cls.startIndex, (shape = classShape(cls)));
  return shape;
}

// ---------------------------------------------------------------------------------------------
// Chamadas

/** `a`, `this`, `base`, `a.b.c` → segmentos; qualquer outra expressão → undefined. */
function memberChain(node: SyntaxNode | null | undefined): string[] | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier') return [node.text];
  if (node.type === 'this_expression') return ['this'];
  if (node.type === 'base_expression') return ['base'];
  if (node.type === 'generic_name') return csType(node);
  if (node.type !== 'member_access_expression') return undefined;
  const name = node.childForFieldName('name');
  const head = memberChain(node.childForFieldName('expression'));
  const last = name?.type === 'identifier' ? name.text : name?.type === 'generic_name' ? csType(name)?.[0] : undefined;
  return head && last ? [...head, last] : undefined;
}

/** O alvo de uma chamada: a expressão do receptor (ou nada) e o nome chamado. */
function callee(fn: SyntaxNode | null | undefined): { receiver?: SyntaxNode; name: string } | undefined {
  if (!fn) return undefined;
  if (fn.type === 'identifier') return { name: fn.text };
  if (fn.type === 'generic_name') {
    const name = csType(fn)?.[0];
    return name ? { name } : undefined;
  }
  if (fn.type === 'member_access_expression') {
    const nameNode = fn.childForFieldName('name');
    const name = nameNode?.type === 'generic_name' ? csType(nameNode)?.[0] : nameNode?.text;
    const receiver = fn.childForFieldName('expression');
    return name && receiver ? { receiver, name } : undefined;
  }
  if (fn.type === 'conditional_access_expression') {
    // `_http?.GetAsync(...)`: o receptor é a condição; o nome está no `member_binding_expression`
    const binding = fn.namedChildren.find((c) => c.type === 'member_binding_expression');
    const nameNode = binding?.childForFieldName('name') ?? binding?.namedChildren[0];
    const name = nameNode?.type === 'generic_name' ? csType(nameNode)?.[0] : nameNode?.text;
    const receiver = fn.childForFieldName('condition') ?? fn.namedChildren[0];
    return name && receiver ? { receiver, name } : undefined;
  }
  return undefined;
}

/** O que se sabe do receptor `chain` visto de `node`: local, campo da classe, `this`/`base` ou tipo (estático/qualificado). */
function receiverOf(node: SyntaxNode, chain: string[], shapes: Map<number, ClassShape>): Pick<CallDesc, 'receiver' | 'shadowed' | 'opaque' | 'scope'> {
  const [root, ...rest] = chain;
  const cls = enclosingClass(node);
  if (root === 'this') return cls ? { receiver: { type: [className(cls)], rest } } : {};
  if (root === 'base') {
    const base = cls && cls.type !== 'struct_declaration' ? csType(baseTypes(cls)[0]) : undefined;
    return base ? { receiver: { type: base, rest } } : {};
  }
  const local = localOf(node, root!);
  if (local) {
    const t = local.type;
    if (t === null) return { shadowed: true, scope: local.scope };
    if (t === 'opaque') return { shadowed: true, opaque: true, scope: local.scope };
    if (!Array.isArray(t)) return { receiver: { call: t.call, rest }, scope: local.scope };
    return { receiver: { type: t, rest }, scope: local.scope };
  }
  // campo/propriedade da classe (inclusive herdado, quando não é nome de tipo): `_repo.Save()` = `this._repo.Save()`
  if (cls && (shapeOf(cls, shapes).properties.includes(root!) || !startsUpper(root!))) {
    return { receiver: { type: [className(cls)], rest: chain } };
  }
  // nome de tipo: `OrderService.Create()` (estático) ou `App.Util.Fmt.Do()` (qualificado) — o grafo acha o prefixo que é classe
  return { receiver: { type: chain, rest: [] } };
}

function startsUpper(name: string): boolean {
  const c = name[0];
  return c !== undefined && c !== '_' && c === c.toUpperCase() && c !== c.toLowerCase();
}

/** Descreve uma chamada `f()`, `a.b.M()`, `x().y()`, `a?.M()` do jeito que o grafo resolve. */
function describeInvocation(node: SyntaxNode, shapes = new Map<number, ClassShape>()): CallDesc | undefined {
  const c = callee(node.childForFieldName('function'));
  if (!c || c.name === 'nameof') return undefined;
  if (!c.receiver) {
    // `Local()` (função local) vai pelo nome; `f()` com `f` variável é delegate; o resto é `this.f()`
    if (localFunction(node, c.name)) return { name: c.name };
    const local = localOf(node, c.name);
    if (local) return { name: c.name, shadowed: true, scope: local.scope };
    const cls = enclosingClass(node);
    if (!cls) return { name: c.name };
    if (shapeOf(cls, shapes).properties.includes(c.name)) return { name: c.name, shadowed: true };
    return { name: c.name, receiver: { type: [className(cls)], rest: [] } };
  }
  const chain = memberChain(c.receiver);
  if (chain) return { name: c.name, object: chain, ...receiverOf(node, chain, shapes) };
  let inner: SyntaxNode | null = c.receiver;
  while (inner && (inner.type === 'parenthesized_expression' || inner.type === 'await_expression')) inner = inner.namedChildren[0] ?? null;
  if (inner?.type === 'invocation_expression') {
    const desc = describeInvocation(inner, shapes);
    if (desc) return { name: c.name, receiver: { call: withArgs(inner, desc), rest: [] } };
  }
  if (inner?.type === 'object_creation_expression') {
    const type = csType(inner.childForFieldName('type'));
    if (type) return { name: c.name, receiver: { type, rest: [] } };
  }
  return { name: c.name, dynamic: true };
}

/** A descrição de uma chamada que produz um receptor, com os argumentos (o grupo de uma minimal API diz o prefixo). */
function withArgs(node: SyntaxNode, desc: CallDesc): CallDesc {
  const args = argumentsOf(node).map((a) => describeArg(a, new Map(), new Map()));
  return args.length > 0 ? { ...desc, args } : desc;
}

/** As expressões dos argumentos (sem `nome:` e sem `ref`/`out`). */
function argumentsOf(call: SyntaxNode): SyntaxNode[] {
  const list = call.childForFieldName('arguments') ?? call.namedChildren.find((c) => c.type === 'argument_list');
  return (list?.namedChildren ?? [])
    .filter((a) => a.type === 'argument')
    .flatMap((a) => {
      const value = [...a.namedChildren].reverse().find((c) => c.type !== 'name_colon');
      return value ? [value] : [];
    });
}

/** O que dá pra saber de um argumento sem executar nada. */
function describeArg(arg: SyntaxNode, symbolAt: Map<number, SymbolInfo>, shapes: Map<number, ClassShape>): RawArg {
  const text = describeText(arg);
  if (text) return text;
  if (LAMBDA_TYPES.has(arg.type)) {
    const symbolId = symbolAt.get(arg.startIndex)?.id;
    return symbolId ? { kind: 'function', symbolId } : { kind: 'function' };
  }
  if (arg.type === 'anonymous_object_creation_expression') {
    const keys: string[] = [];
    const texts: Record<string, { kind: 'string'; value: string } | { kind: 'template'; prefix: string }> = {};
    const named = arg.namedChildren;
    for (let i = 0; i < named.length; i++) {
      const n = named[i]!;
      if (n.type === 'name_equals') {
        const key = n.namedChildren[0]?.text;
        const value = named[i + 1];
        if (!key) continue;
        keys.push(key);
        const t = value ? describeText(value) : undefined;
        if (t) texts[key] = t;
        i++;
      } else {
        const chain = memberChain(n);
        if (chain) keys.push(chain.at(-1)!);
      }
    }
    return { kind: 'object', keys, ...(Object.keys(texts).length > 0 && { texts }) };
  }
  if (arg.type === 'invocation_expression') {
    const callee = memberChain(arg.childForFieldName('function'));
    if (callee) return { kind: 'call', callee };
  }
  const chain = memberChain(arg);
  if (!chain || chain[0] === 'base' || (chain.length === 1 && chain[0] === 'this')) return { kind: 'other' };
  const local = chain[0] === 'this' ? undefined : localOf(arg, chain[0]!);
  const ref: CallDesc =
    chain.length === 1
      ? describeRef(arg, chain[0]!, shapes)
      : { name: chain.at(-1)!, object: chain.slice(0, -1), ...receiverOf(arg, chain.slice(0, -1), shapes) };
  return { kind: 'name', chain, ref, ...(local && { scope: local.scope }) };
}

/** Um nome solto passado como valor: método da classe (grupo de métodos), função local ou variável. */
function describeRef(node: SyntaxNode, name: string, shapes: Map<number, ClassShape>): CallDesc {
  if (localFunction(node, name)) return { name };
  const local = localOf(node, name);
  if (local) return { name, shadowed: true };
  const cls = enclosingClass(node);
  if (!cls || shapeOf(cls, shapes).properties.includes(name)) return { name, shadowed: true };
  return { name, receiver: { type: [className(cls)], rest: [] } };
}

// ---------------------------------------------------------------------------------------------
// Símbolos

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of node.namedChildren) walk(child, visit);
}

/** Dentro de método, construtor, função local, acessor ou lambda (não é código de topo)? */
function insideFunction(node: SyntaxNode): boolean {
  for (let n = node.parent; n; n = n.parent) if (FUNCTION_TYPES.has(n.type)) return true;
  return false;
}

/** O nome chamado quando `lambda` é argumento de uma chamada (`app.MapGet`), com o rótulo do callback. */
function callbackOf(lambda: SyntaxNode): { name: string; label: string } | undefined {
  const argument = lambda.parent?.type === 'argument' ? lambda.parent : undefined;
  const call = argument?.parent?.type === 'argument_list' ? argument.parent.parent : undefined;
  if (call?.type !== 'invocation_expression') return undefined;
  const fn = call.childForFieldName('function');
  const c = callee(fn);
  if (!c) return undefined;
  const chain = memberChain(fn)?.join('.') ?? c.name;
  const first = argumentsOf(call)[0];
  const literal = first && (first.type === 'string_literal' || first.type === 'verbatim_string_literal') ? first.text : '';
  return { name: c.name, label: `${chain}(${literal})` };
}

/** Convenção do .NET para interface: `I` + maiúscula (`IOrderRepository`, não `Item`). */
function looksLikeInterface(name: string): boolean {
  return name.length > 1 && name[0] === 'I' && startsUpper(name.slice(1));
}

function extractSymbols(root: SyntaxNode, fileId: string, fileScoped: string | undefined, shapes: Map<number, ClassShape>): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const interfaces = new Set<string>();
  walk(root, (n) => {
    if (n.type !== 'interface_declaration') return;
    const name = n.childForFieldName('name')?.text;
    if (name) interfaces.add(name);
    return false;
  });
  const push = (node: SyntaxNode, kind: SymbolKind, name: string, extra: Partial<SymbolInfo> = {}, nameNode?: SyntaxNode | null) => {
    const params = node.childForFieldName('parameters') ?? node.namedChildren.find((c) => c.type === 'parameter_list');
    const info: SymbolInfo = {
      id: '',
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: params?.text,
      bodyHash: bodyHash(node, nameNode),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (info as unknown as Record<string, unknown>)[k] = v;
    results.push(info);
  };

  walk(root, (node) => {
    if (CLASS_TYPES.has(node.type)) {
      const bases = baseTypes(node);
      const isStruct = node.type === 'struct_declaration' || node.type === 'record_struct_declaration';
      // a 1ª base pode ser classe ou interface (o C# mistura as duas): não é classe-base se é interface
      // declarada no arquivo ou segue a convenção do .NET (`IRepo`); o grafo resolve a base sem cair nas implementações
      const first = isStruct ? undefined : csType(bases[0]);
      const ext = first && !interfaces.has(first.at(-1)!) && !looksLikeInterface(first.at(-1)!) ? first : undefined;
      const implemented = bases.map((b) => csType(b)?.at(-1)).filter((n): n is string => !!n);
      const shape = shapeOf(node, shapes);
      push(
        node,
        'class',
        className(node),
        {
          namespace: namespaceOf(node, fileScoped),
          extends: ext,
          extendsArg: ext ? firstTypeArg(bases[0]) : undefined,
          implements: implemented.length > 0 ? implemented : undefined,
          fields: Object.keys(shape.fields).length > 0 ? shape.fields : undefined,
          fieldArgs: Object.keys(shape.fieldArgs).length > 0 ? shape.fieldArgs : undefined,
          properties: shape.properties.length > 0 ? shape.properties : undefined,
        },
        node.childForFieldName('name')
      );
      return;
    }
    if (TYPE_DECLARATIONS.has(node.type)) return false; // interface, enum, delegate: sem corpo executável
    if (node.type === 'method_declaration' || node.type === 'constructor_declaration') {
      const cls = enclosingClass(node);
      const name = node.childForFieldName('name')?.text;
      if (!cls || !name) return;
      const returns = node.type === 'method_declaration' ? returnType(node.childForFieldName('type') ?? node.childForFieldName('returns')) : undefined;
      push(node, 'method', name, { container: className(cls), returns }, node.childForFieldName('name'));
      return;
    }
    if (node.type === 'local_function_statement') {
      const name = node.childForFieldName('name')?.text;
      if (name) push(node, 'function', name, { returns: returnType(node.childForFieldName('type') ?? node.childForFieldName('returns')) }, node.childForFieldName('name'));
      return;
    }
    if (LAMBDA_TYPES.has(node.type)) {
      // callback no topo do arquivo (Program.cs) ou handler de endpoint (`app.MapGet("/x", ...)`) em qualquer lugar
      const cb = callbackOf(node);
      if (cb && (!insideFunction(node) || ENDPOINT_MAPPERS.has(cb.name))) push(node, 'function', cb.label);
    }
  });

  stableIds(results, fileId);
  return results;
}

// ---------------------------------------------------------------------------------------------
// Chamadas do arquivo

function extractCalls(root: SyntaxNode, symbols: SymbolInfo[], fileId: string, shapes: Map<number, ClassShape>): RawCall[] {
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
  const position = (node: SyntaxNode) => ({ line: node.startPosition.row, column: node.startPosition.column, end: node.endIndex });

  walk(root, (node) => {
    if (node.type === 'invocation_expression') {
      const caller = enclosing(node.startIndex) ?? fileId;
      const desc = describeInvocation(node, shapes);
      if (!desc) return;
      const argNodes = argumentsOf(node);
      const args = argNodes.map((a) => describeArg(a, symbolAt, shapes));
      results.push({ caller, ...desc, ...position(node), args });
      // callback e grupo de métodos passados como valor (`app.MapPost("/x", Handlers.Checkout)`): referência, como no TS
      args.forEach((arg, i) => {
        if (arg.kind === 'function' && arg.symbolId) results.push({ caller, name: symbolAt.get(argNodes[i]!.startIndex)!.name, kind: 'ref', symbolId: arg.symbolId });
        else if (arg.kind === 'name' && !arg.ref.shadowed && !arg.ref.opaque) results.push({ caller, ...arg.ref, kind: 'ref' });
      });
      return;
    }
    if (node.type === 'object_creation_expression' || node.type === 'implicit_object_creation_expression') {
      const type = node.type === 'object_creation_expression' ? csType(node.childForFieldName('type')) : implicitType(node);
      if (!type) return;
      const caller = enclosing(node.startIndex) ?? fileId;
      results.push({
        caller,
        name: type.at(-1)!,
        ctor: true,
        receiver: { type, rest: [] },
        ...position(node),
        args: argumentsOf(node).map((a) => describeArg(a, symbolAt, shapes)),
      });
      return;
    }
    if (node.type === 'attribute_list') {
      // `[HttpGet("{id}")]` no método / `[Route("api/[controller]")]` na classe: a chamada `decorates` o símbolo
      const decorated = node.parent ? symbolAt.get(node.parent.startIndex) : undefined;
      if (!decorated) return false;
      for (const attr of node.namedChildren.filter((a) => a.type === 'attribute')) {
        const type = csType(attr.childForFieldName('name'));
        if (!type) continue;
        const name = attributeName(type.at(-1)!);
        const args = (attr.namedChildren.find((c) => c.type === 'attribute_argument_list')?.namedChildren ?? [])
          .filter((a) => a.type === 'attribute_argument')
          .flatMap((a): RawArg[] => {
            if (a.namedChildren.some((c) => c.type === 'name_equals' || c.type === 'name_colon')) return [];
            const value = a.namedChildren.at(-1);
            return value ? [describeArg(value, symbolAt, shapes)] : [];
          });
        results.push({ caller: decorated.id, name, decorates: decorated.id, ...position(attr), args });
      }
      return false;
    }
  });
  return results;
}

/** `Order o = new();` / `private Repo _r = new();`: o tipo vem da declaração. */
function implicitType(node: SyntaxNode): TypeRef | undefined {
  const clause = node.parent?.type === 'equals_value_clause' ? node.parent : undefined;
  const decl = clause?.parent?.type === 'variable_declarator' ? clause.parent.parent : undefined;
  return decl?.type === 'variable_declaration' ? csType(decl.childForFieldName('type')) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Tabela de "módulo": os tipos de fora (pacotes) e os valores dos comandos de topo

/**
 * Os tipos de fora que o arquivo usa viram ligações de import para o pacote deles (`DbContext` →
 * EF Core): é o que faz o resto do motor (pacotes, I/O, cobertura) funcionar igual ao TS. Um tipo
 * declarado no próprio arquivo com o mesmo nome não vira ligação.
 */
function moduleInfo(root: SyntaxNode, symbols: SymbolInfo[], shapes: Map<number, ClassShape>): ModuleInfo & { valueCalls: Map<string, CallDesc> } {
  const declared = new Set(symbols.filter((s) => s.kind === 'class').map((s) => s.name));
  walk(root, (n) => {
    if (n.type === 'interface_declaration' || n.type === 'enum_declaration' || n.type === 'delegate_declaration') {
      const name = n.childForFieldName('name')?.text;
      if (name) declared.add(name);
    }
  });
  const used = new Set<string>();
  walk(root, (n) => {
    if (n.type === 'identifier') {
      const name = attributeName(n.text);
      if (Object.hasOwn(CSHARP_EXTERNAL_TYPES, name) && !declared.has(name)) used.add(name);
    }
    return n.type !== 'using_directive';
  });
  const imports: ImportBinding[] = [...used].sort().map((name) => ({ local: name, imported: name, spec: CSHARP_EXTERNAL_TYPES[name]! }));
  const specs = [...new Set(imports.map((b) => b.spec))].sort();

  // comandos de topo (Program.cs): `var app = builder.Build();` / `var svc = new OrderService();`
  const valueCalls = new Map<string, CallDesc>();
  const valueTypes = new Map<string, TypeRef>();
  for (const g of root.namedChildren) {
    const stmt = g.type === 'global_statement' ? g.namedChildren[0] : undefined;
    if (stmt?.type !== 'local_declaration_statement') continue;
    const decl = stmt.namedChildren.find((c) => c.type === 'variable_declaration');
    for (const d of declarators(decl)) {
      let v: SyntaxNode | null | undefined = d.value;
      while (v && (v.type === 'await_expression' || v.type === 'parenthesized_expression')) v = v.namedChildren[0];
      if (v?.type === 'invocation_expression') {
        const desc = describeInvocation(v, shapes);
        if (desc) valueCalls.set(d.name, withArgs(v, desc));
      } else {
        const t = typeOfDeclared(decl?.childForFieldName('type'), d.value ?? undefined);
        if (Array.isArray(t)) valueTypes.set(d.name, t);
      }
    }
  }
  return {
    specs,
    imports,
    exports: new Map(),
    reexports: [],
    valueTypes,
    objectRefs: new Map(),
    arrays: new Map(),
    aliases: new Map(),
    objectRequires: new Map(),
    valueCalls,
  };
}

/** Tudo o que o grafo guarda de um arquivo C#. */
export function extractCSharp(root: SyntaxNode, fileId: string): FileExtraction {
  const { scope, fileScoped } = namespaceScope(root);
  const shapes = new Map<number, ClassShape>();
  const symbols = extractSymbols(root, fileId, fileScoped, shapes);
  const { valueCalls, ...module } = moduleInfo(root, symbols, shapes);
  return {
    symbols,
    module,
    valueCalls,
    calls: extractCalls(root, symbols, fileId, shapes),
    topHash: topLevelHash(root, symbols),
    scope,
  };
}
