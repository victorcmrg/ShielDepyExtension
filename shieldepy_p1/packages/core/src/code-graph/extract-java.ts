// Leitura da árvore Tree-sitter de um arquivo Java: símbolos (classes, records, enums, métodos,
// construtores e os repositórios do Spring Data), o package de cada classe, as chamadas com o tipo
// do receptor e as anotações (que viram chamadas `decorates`, como os atributos do C#). Etapa J.
// Funções puras, sem regex: tudo vem dos nós da AST.
//
// A resolução é por package, pelo mesmo `NamespaceScope` do C#: o próprio package e os `import x.*;`
// ficam visíveis, e cada `import x.y.Tipo;` é um alias. Os tipos de fora entram pelo import.

import type { ImportBinding, ModuleInfo } from './extract-module';
import { stableIds, type CallDesc, type RawArg, type RawCall, type Scope, type SymbolInfo, type TypeRef } from './extract-ts';
import { bodyHash, topLevelHash } from './fingerprint';
import type { FileExtraction, NamespaceScope } from './frontend';
import type { SyntaxNode } from './parser';
import type { CallArg, SymbolKind } from './types';

/** Um tipo de fora que o mapa reconhece: o "pacote" dele e os prefixos de package de onde ele é importado. */
interface ExternalType {
  pkg: string;
  prefixes: string[];
}

const SPRING_DATA = { pkg: 'spring-data', prefixes: ['org.springframework.data'] };
const SPRING_WEB = { pkg: 'spring-web', prefixes: ['org.springframework.web.bind.annotation', 'org.springframework.stereotype'] };
const SPRING_TX = { pkg: 'spring-tx', prefixes: ['org.springframework.transaction', 'jakarta.transaction', 'javax.transaction'] };
const JPA = { pkg: 'jpa', prefixes: ['jakarta.persistence', 'javax.persistence'] };

/** Repositórios do Spring Data: a interface do projeto que estende um deles é o repositório de uma entidade. */
const SPRING_DATA_REPOSITORIES = [
  'Repository',
  'CrudRepository',
  'ListCrudRepository',
  'PagingAndSortingRepository',
  'ListPagingAndSortingRepository',
  'JpaRepository',
  'JpaSpecificationExecutor',
  'MongoRepository',
  'ReactiveCrudRepository',
  'ReactiveMongoRepository',
  'R2dbcRepository',
  'ElasticsearchRepository',
];

/**
 * Tipos de fora que importam para o mapa e para o caos, pelo nome simples. Só valem quando o arquivo os
 * importa de um dos prefixos (o Java sempre importa): um `Repository` do próprio projeto não é o do Spring.
 */
export const JAVA_EXTERNAL_TYPES: Readonly<Record<string, ExternalType>> = {
  ...Object.fromEntries(SPRING_DATA_REPOSITORIES.map((n) => [n, SPRING_DATA])),
  JdbcTemplate: { pkg: 'spring-jdbc', prefixes: ['org.springframework.jdbc'] },
  NamedParameterJdbcTemplate: { pkg: 'spring-jdbc', prefixes: ['org.springframework.jdbc'] },
  JdbcClient: { pkg: 'spring-jdbc', prefixes: ['org.springframework.jdbc'] },
  EntityManager: JPA,
  RestTemplate: { pkg: 'spring-web-client', prefixes: ['org.springframework.web.client'] },
  RestClient: { pkg: 'spring-web-client', prefixes: ['org.springframework.web.client'] },
  WebClient: { pkg: 'spring-webclient', prefixes: ['org.springframework.web.reactive.function.client'] },
  HttpClient: { pkg: 'java.net.http', prefixes: ['java.net.http'] },
  RestController: SPRING_WEB,
  Controller: SPRING_WEB,
  RequestMapping: SPRING_WEB,
  GetMapping: SPRING_WEB,
  PostMapping: SPRING_WEB,
  PutMapping: SPRING_WEB,
  PatchMapping: SPRING_WEB,
  DeleteMapping: SPRING_WEB,
  RequestMethod: SPRING_WEB,
  Transactional: SPRING_TX,
  TransactionTemplate: SPRING_TX,
};

const CLASS_TYPES = new Set(['class_declaration', 'record_declaration', 'enum_declaration']);
const TYPE_DECLARATIONS = new Set([...CLASS_TYPES, 'interface_declaration', 'annotation_type_declaration']);
const FUNCTION_TYPES = new Set(['method_declaration', 'constructor_declaration', 'compact_constructor_declaration', 'lambda_expression']);
/** Tipos que embrulham o valor de quem chama: o retorno é o de dentro (como o `Task<T>` do C#). */
const WRAPPERS = new Set(['Optional', 'CompletableFuture', 'CompletionStage', 'Future', 'Mono', 'Flux', 'Callable']);
/** Genéricos da biblioteca padrão: nunca classe do projeto (qualificados em `java`, como o `System` do C#). */
const LIB_GENERICS = new Set([
  'List', 'ArrayList', 'LinkedList', 'Set', 'HashSet', 'LinkedHashSet', 'TreeSet', 'Map', 'HashMap', 'LinkedHashMap', 'TreeMap',
  'Collection', 'Iterable', 'Iterator', 'Stream', 'Optional', 'Queue', 'Deque', 'ArrayDeque', 'Function', 'BiFunction', 'Supplier',
  'Consumer', 'BiConsumer', 'Predicate', 'Comparator', 'ConcurrentHashMap', 'CopyOnWriteArrayList', 'Page', 'Slice',
]);
const PRIMITIVE_TYPES = new Set(['integral_type', 'floating_point_type', 'boolean_type', 'void_type', 'array_type']);
const OPAQUE_VALUES = new Set(['string_literal', 'decimal_integer_literal', 'hex_integer_literal', 'decimal_floating_point_literal', 'true', 'false', 'character_literal', 'array_creation_expression']);
/** Lombok: anotações de classe que geram os acessores. */
const LOMBOK_ACCESSORS = new Set(['Data', 'Getter', 'Setter', 'Value', 'Builder', 'SuperBuilder']);
const ENUM_MEMBERS = ['values', 'valueOf', 'name', 'ordinal', 'compareTo'];
/** Herdados de `Object` por toda classe: chamá-los sem receptor é nativo (`getClass()`, `equals(o)`). */
const OBJECT_METHODS = new Set(['getClass', 'equals', 'hashCode', 'toString', 'notify', 'notifyAll', 'wait', 'clone', 'finalize']);

/** Os `import static`: membro com nome → a classe dele; `import static x.Y.*;` → as classes possíveis. */
export interface StaticImports {
  members: Map<string, TypeRef>;
  wildcards: TypeRef[];
}

// ---------------------------------------------------------------------------------------------
// Tipos e nomes

/** `Repo` → ['Repo'], `com.x.Repo` → ['com','x','Repo'], `Repo<X>` → ['Repo']. Primitivo, array → undefined. */
export function javaType(node: SyntaxNode | null | undefined): TypeRef | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'type_identifier':
    case 'identifier':
      return [node.text];
    case 'scoped_type_identifier':
    case 'scoped_identifier':
      return node.namedChildren.flatMap((c) => javaType(c) ?? []);
    case 'generic_type':
      return javaType(node.namedChildren.find((c) => c.type !== 'type_arguments'));
    case 'annotated_type':
      return javaType(node.namedChildren.at(-1));
    default:
      return undefined;
  }
}

/** O tipo de uma declaração, com os genéricos da biblioteca padrão qualificados em `java` (nativos, mas com o nome). */
function declaredType(type: SyntaxNode | null | undefined): TypeRef | undefined {
  const name = type?.type === 'generic_type' ? javaType(type)?.at(-1) : undefined;
  if (name && LIB_GENERICS.has(name)) return ['java', name];
  return javaType(type);
}

/** `Repository<Order>` → `Order` (o 1º argumento de tipo, quando é um nome). */
function firstTypeArg(node: SyntaxNode | null | undefined): string | undefined {
  if (node?.type !== 'generic_type') return undefined;
  const args = node.namedChildren.find((c) => c.type === 'type_arguments');
  return javaType(args?.namedChildren[0])?.at(-1);
}

/** Retorno: `void`, primitivos, coleções e os embrulhos (`Optional<T>`) viram `[]` (nativo); o resto, o tipo. */
function returnType(type: SyntaxNode | null | undefined): TypeRef | undefined {
  if (!type) return undefined;
  if (type.type === 'generic_type' || PRIMITIVE_TYPES.has(type.type)) return [];
  return javaType(type) ?? [];
}

/**
 * O T de um retorno `Optional<T>`/`CompletableFuture<T>`/`Mono<T>`: o método chamado logo depois é do embrulho
 * (`find(id).orElseThrow()`), mas quem desembrulha devolve T (`var o = find(id).orElseThrow(); o.validate()`).
 */
function unwrapped(type: SyntaxNode | null | undefined): TypeRef | undefined {
  if (type?.type !== 'generic_type') return undefined;
  const name = javaType(type)?.at(-1);
  const args = type.namedChildren.find((c) => c.type === 'type_arguments');
  return name && WRAPPERS.has(name) ? declaredType(args?.namedChildren[0]) : undefined;
}

function qualifiedText(node: SyntaxNode | null | undefined): string | undefined {
  return javaType(node)?.join('.');
}

// ---------------------------------------------------------------------------------------------
// Texto literal

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '0': '\0', b: '\b', f: '\f' };

/** `"a\"b"` → `a"b`; text block `"""\n x"""` → `x` (o conteúdo, sem a indentação comum). */
function literalText(node: SyntaxNode): string | undefined {
  if (node.type !== 'string_literal') return undefined;
  let out = '';
  for (const c of node.namedChildren) {
    if (c.type === 'escape_sequence') out += ESCAPES[c.text[1] ?? ''] ?? c.text.slice(1);
    else if (c.type === 'string_fragment' || c.type === 'multiline_string_fragment') out += c.text;
  }
  return node.text.startsWith('"""') ? out.trim() : out;
}

// ---------------------------------------------------------------------------------------------
// Package, imports e classes

function staticImports(root: SyntaxNode): StaticImports {
  const members = new Map<string, TypeRef>();
  const wildcards: TypeRef[] = [];
  for (const imp of root.namedChildren.filter((c) => c.type === 'import_declaration' && c.children.some((t) => t.type === 'static'))) {
    const ref = javaType(imp.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier'));
    if (!ref) continue;
    if (imp.namedChildren.some((c) => c.type === 'asterisk')) wildcards.push(ref);
    else if (ref.length > 1) members.set(ref.at(-1)!, ref.slice(0, -1));
  }
  return { members, wildcards };
}

function packageScope(root: SyntaxNode): { scope: NamespaceScope; pkg: string; imports: Array<{ qualified: string; wildcard: boolean }> } {
  const pkgNode = root.namedChildren.find((c) => c.type === 'package_declaration');
  const pkg = qualifiedText(pkgNode?.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier')) ?? '';
  const visible = new Set<string>(pkg ? [pkg] : []);
  const aliases: Record<string, string> = {};
  const imports: Array<{ qualified: string; wildcard: boolean }> = [];
  for (const imp of root.namedChildren.filter((c) => c.type === 'import_declaration')) {
    if (imp.children.some((c) => c.type === 'static')) continue; // `import static`: membros, não tipos
    const qualified = qualifiedText(imp.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier'));
    if (!qualified) continue;
    const wildcard = imp.namedChildren.some((c) => c.type === 'asterisk');
    imports.push({ qualified, wildcard });
    if (wildcard) visible.add(qualified);
    else aliases[qualified.slice(qualified.lastIndexOf('.') + 1)] = qualified;
  }
  return { scope: { visible: [...visible].sort(), aliases }, pkg, imports };
}

function className(cls: SyntaxNode): string {
  return cls.childForFieldName('name')?.text ?? '<anônima>';
}

function enclosingClass(node: SyntaxNode): SyntaxNode | undefined {
  for (let n = node.parent; n; n = n.parent) if (CLASS_TYPES.has(n.type) || isRepositoryInterface(n)) return n;
  return undefined;
}

/** `Outer.Inner` para uma classe aninhada; nada para uma de topo. */
function outerClasses(cls: SyntaxNode): string | undefined {
  const outer: string[] = [];
  for (let o = enclosingClass(cls); o; o = enclosingClass(o)) outer.unshift(className(o));
  return outer.length > 0 ? outer.join('.') : undefined;
}

/** Os tipos de `extends` de uma interface (`extends JpaRepository<Order, Long>, Custom`). */
function interfaceBases(node: SyntaxNode): SyntaxNode[] {
  const ext = node.namedChildren.find((c) => c.type === 'extends_interfaces');
  return ext?.namedChildren.find((c) => c.type === 'type_list')?.namedChildren ?? [];
}

/**
 * Interface que é repositório do Spring Data: estende um repositório do Spring (`JpaRepository<Order, Long>`)
 * ou se chama `*Repository` e estende outro (a base própria do projeto). O Spring gera a implementação, então
 * ela vira símbolo de classe — a base é o pacote, e o 1º argumento de tipo é a entidade.
 */
function isRepositoryInterface(node: SyntaxNode): boolean {
  if (node.type !== 'interface_declaration') return false;
  const bases = interfaceBases(node);
  if (bases.length === 0) return false;
  if (bases.some((b) => SPRING_DATA_REPOSITORIES.includes(javaType(b)?.at(-1) ?? ''))) return true;
  return className(node).endsWith('Repository');
}

function modifiersOf(node: SyntaxNode): SyntaxNode | undefined {
  return node.namedChildren.find((c) => c.type === 'modifiers');
}

/** Nomes das anotações de uma declaração (`@Data`, `@lombok.Getter` → `Getter`). */
function annotationNames(node: SyntaxNode): string[] {
  return (modifiersOf(node)?.namedChildren ?? [])
    .filter((a) => a.type === 'marker_annotation' || a.type === 'annotation')
    .flatMap((a) => javaType(a.childForFieldName('name'))?.slice(-1) ?? []);
}

interface ClassShape {
  fields: Record<string, TypeRef>;
  fieldArgs: Record<string, string>;
  properties: string[];
}

function declarators(declaration: SyntaxNode): Array<{ name: string; value?: SyntaxNode }> {
  return declaration.namedChildren
    .filter((d) => d.type === 'variable_declarator')
    .flatMap((d) => {
      const name = d.childForFieldName('name')?.text;
      const value = d.childForFieldName('value');
      return name ? [{ name, value: value ?? undefined }] : [];
    });
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Campos (inclusive os componentes do record) com o tipo; a injeção pelo construtor (`this.repo = repo`). */
function classShape(cls: SyntaxNode): ClassShape {
  const fields: Record<string, TypeRef> = {};
  const fieldArgs: Record<string, string> = {};
  const properties = new Set<string>();
  const add = (name: string, type: SyntaxNode | null | undefined, value?: SyntaxNode) => {
    properties.add(name);
    const t = declaredType(type) ?? (value?.type === 'object_creation_expression' ? declaredType(value.childForFieldName('type')) : undefined);
    if (t && !fields[name]) fields[name] = t;
    const arg = firstTypeArg(type);
    if (arg && !fieldArgs[name]) fieldArgs[name] = arg;
  };
  const lombok = annotationNames(cls).some((n) => LOMBOK_ACCESSORS.has(n));
  const fieldNames: Array<{ name: string; type?: SyntaxNode | null; accessors: boolean }> = [];
  // record: cada componente é campo e acessor (`order.sku()`)
  if (cls.type === 'record_declaration') {
    for (const p of cls.childForFieldName('parameters')?.namedChildren ?? []) {
      const name = p.childForFieldName('name')?.text;
      if (p.type === 'formal_parameter' && name) add(name, p.childForFieldName('type'));
    }
  }
  const body = cls.childForFieldName('body');
  const members = cls.type === 'enum_declaration' ? body?.namedChildren.find((c) => c.type === 'enum_body_declarations')?.namedChildren ?? [] : body?.namedChildren ?? [];
  for (const member of members) {
    if (member.type === 'field_declaration') {
      const own = annotationNames(member).some((n) => n === 'Getter' || n === 'Setter');
      for (const d of declarators(member)) {
        add(d.name, member.childForFieldName('type'), d.value);
        fieldNames.push({ name: d.name, type: member.childForFieldName('type'), accessors: lombok || own });
      }
    } else if (member.type === 'constructor_declaration') {
      const params = new Map<string, SyntaxNode>();
      for (const p of member.childForFieldName('parameters')?.namedChildren ?? []) {
        const name = p.childForFieldName('name')?.text;
        const type = p.childForFieldName('type');
        if (name && type) params.set(name, type);
      }
      walk(member.childForFieldName('body') ?? member, (n) => {
        if (n.type !== 'assignment_expression') return;
        const left = n.childForFieldName('left');
        const field = left?.type === 'field_access' && left.childForFieldName('object')?.type === 'this' ? left.childForFieldName('field')?.text : left?.type === 'identifier' ? left.text : undefined;
        const right = n.childForFieldName('right');
        if (!field) return;
        properties.add(field);
        if (right?.type === 'identifier' && params.has(right.text)) add(field, params.get(right.text));
        else if (right?.type === 'object_creation_expression') add(field, right.childForFieldName('type'));
      });
    }
  }
  // Lombok (`@Data`, `@Getter`...): os acessores gerados existem, e chamá-los é nativo (não é "sem alvo")
  for (const f of fieldNames.filter((x) => x.accessors)) {
    properties.add(`get${capitalize(f.name)}`).add(`set${capitalize(f.name)}`);
    if (f.type?.type === 'boolean_type') properties.add(`is${capitalize(f.name)}`);
  }
  if (lombok) for (const m of ['builder', 'toBuilder', 'equals', 'hashCode', 'toString']) properties.add(m);
  if (cls.type === 'enum_declaration') for (const m of ENUM_MEMBERS) properties.add(m);
  return { fields, fieldArgs, properties: [...properties] };
}

function shapeOf(cls: SyntaxNode, cache: Map<number, ClassShape>): ClassShape {
  let shape = cache.get(cls.startIndex);
  if (!shape) cache.set(cls.startIndex, (shape = isRepositoryInterface(cls) ? { fields: {}, fieldArgs: {}, properties: [] } : classShape(cls)));
  return shape;
}

// ---------------------------------------------------------------------------------------------
// Variáveis locais

type LocalType = TypeRef | null | 'opaque' | { call: CallDesc };

function typeOfDeclared(type: SyntaxNode | null | undefined, value: SyntaxNode | undefined): LocalType {
  if (type && !(type.type === 'type_identifier' && type.text === 'var')) {
    if (PRIMITIVE_TYPES.has(type.type)) return 'opaque';
    return declaredType(type) ?? null;
  }
  return value ? valueType(value) : null;
}

function valueType(value: SyntaxNode): LocalType {
  let v: SyntaxNode | null | undefined = value;
  while (v?.type === 'parenthesized_expression') v = v.namedChildren[0];
  if (!v) return null;
  if (OPAQUE_VALUES.has(v.type)) return 'opaque';
  if (v.type === 'object_creation_expression') return declaredType(v.childForFieldName('type')) ?? null;
  if (v.type === 'cast_expression') return declaredType(v.childForFieldName('type')) ?? null;
  if (v.type === 'method_invocation') {
    const desc = describeInvocation(v);
    return desc ? { call: withArgs(v, desc) } : null;
  }
  return null;
}

function paramIn(fn: SyntaxNode, name: string): LocalType | undefined {
  const params = fn.childForFieldName('parameters');
  if (fn.type === 'lambda_expression') {
    if (params?.type === 'identifier') return params.text === name ? null : undefined;
    if (params?.type === 'inferred_parameters') return params.namedChildren.some((c) => c.text === name) ? null : undefined;
  }
  for (const p of params?.namedChildren ?? []) {
    if (p.type === 'formal_parameter' && p.childForFieldName('name')?.text === name) return typeOfDeclared(p.childForFieldName('type'), undefined);
    if (p.type === 'spread_parameter' && p.namedChildren.some((c) => c.type === 'variable_declarator' && c.childForFieldName('name')?.text === name)) return 'opaque';
  }
  return undefined;
}

function declaredIn(block: SyntaxNode, name: string, from: SyntaxNode): LocalType | undefined {
  for (const stmt of block.namedChildren) {
    if (stmt.type !== 'local_variable_declaration') continue;
    for (const d of declarators(stmt)) {
      if (d.name !== name) continue;
      if (d.value && from.startIndex >= d.value.startIndex && from.endIndex <= d.value.endIndex) return null;
      return typeOfDeclared(stmt.childForFieldName('type'), d.value);
    }
  }
  return undefined;
}

interface Local {
  type: LocalType;
  scope: Scope;
}

function localOf(from: SyntaxNode, name: string): Local | undefined {
  for (let n = from.parent; n; n = n.parent) {
    if (FUNCTION_TYPES.has(n.type)) {
      const t = paramIn(n, name);
      if (t !== undefined) return { type: t, scope: 'local' };
    }
    if (n.type === 'block' || n.type === 'constructor_body' || n.type === 'switch_block_statement_group') {
      const t = declaredIn(n, name, from);
      if (t !== undefined) return { type: t, scope: 'local' };
    }
    if (n.type === 'enhanced_for_statement' && n.childForFieldName('name')?.text === name) {
      return { type: typeOfDeclared(n.childForFieldName('type'), undefined), scope: 'local' };
    }
    if (n.type === 'for_statement') {
      const init = n.childForFieldName('init');
      if (init?.type === 'local_variable_declaration' && declarators(init).some((d) => d.name === name)) return { type: typeOfDeclared(init.childForFieldName('type'), undefined), scope: 'local' };
    }
    if (n.type === 'catch_clause') {
      const p = n.namedChildren.find((c) => c.type === 'catch_formal_parameter');
      if (p?.childForFieldName('name')?.text === name) return { type: null, scope: 'local' };
    }
    if (n.type === 'try_with_resources_statement') {
      for (const r of n.childForFieldName('resources')?.namedChildren ?? []) {
        if (r.type === 'resource' && r.childForFieldName('name')?.text === name) return { type: typeOfDeclared(r.childForFieldName('type'), r.childForFieldName('value') ?? undefined), scope: 'local' };
      }
    }
    // `o instanceof Order ord` / padrões: declarada numa expressão
    if (n.type === 'block') {
      let found: LocalType | undefined;
      walk(n, (x) => {
        if (found !== undefined) return false;
        if (x.type === 'instanceof_expression' && x.childForFieldName('name')?.text === name) found = declaredType(x.childForFieldName('right')) ?? null;
        if (x.type === 'type_pattern' && x.namedChildren.at(-1)?.text === name) found = declaredType(x.namedChildren[0]) ?? null;
        return !FUNCTION_TYPES.has(x.type) || x.startIndex === n.startIndex;
      });
      if (found !== undefined) return { type: found, scope: 'local' };
    }
    if (CLASS_TYPES.has(n.type)) return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Chamadas

/** `a`, `this`, `super`, `a.b.c` → segmentos; qualquer outra expressão → undefined. */
function memberChain(node: SyntaxNode | null | undefined): string[] | undefined {
  if (!node) return undefined;
  if (node.type === 'identifier' || node.type === 'type_identifier') return [node.text];
  if (node.type === 'this') return ['this'];
  if (node.type === 'super') return ['super'];
  if (node.type === 'scoped_identifier' || node.type === 'scoped_type_identifier') return javaType(node);
  if (node.type !== 'field_access') return undefined;
  const head = memberChain(node.childForFieldName('object'));
  const field = node.childForFieldName('field');
  return head && field?.type === 'identifier' ? [...head, field.text] : undefined;
}

function startsUpper(name: string): boolean {
  const c = name[0];
  return c !== undefined && c !== '_' && c === c.toUpperCase() && c !== c.toLowerCase();
}

/** A base de uma classe (`extends X`), como está escrita. */
function superclassOf(cls: SyntaxNode): SyntaxNode | undefined {
  const sup = cls.childForFieldName('superclass') ?? cls.namedChildren.find((c) => c.type === 'superclass');
  return sup?.namedChildren[0];
}

function receiverOf(node: SyntaxNode, chain: string[], shapes: Map<number, ClassShape>): Pick<CallDesc, 'receiver' | 'shadowed' | 'opaque' | 'scope'> {
  const [root, ...rest] = chain;
  const cls = enclosingClass(node);
  if (root === 'this') return cls ? { receiver: { type: [className(cls)], rest } } : {};
  if (root === 'super') {
    const base = cls ? javaType(superclassOf(cls)) : undefined;
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
  if (cls && (shapeOf(cls, shapes).properties.includes(root!) || !startsUpper(root!))) return { receiver: { type: [className(cls)], rest: chain } };
  return { receiver: { type: chain, rest: [] } };
}

/** A classe anônima em volta de `node` (`new HashMap<>() {{ put(..) }}`), antes da classe nomeada: o tipo dela. */
function anonymousBase(node: SyntaxNode): TypeRef | undefined {
  for (let n = node.parent; n; n = n.parent) {
    if (CLASS_TYPES.has(n.type) || isRepositoryInterface(n)) return undefined;
    if (n.type === 'class_body' && n.parent?.type === 'object_creation_expression') return declaredType(n.parent.childForFieldName('type')) ?? [];
  }
  return undefined;
}

function describeInvocation(node: SyntaxNode, shapes = new Map<number, ClassShape>(), statics?: StaticImports): CallDesc | undefined {
  const name = node.childForFieldName('name')?.text;
  if (!name) return undefined;
  const object = node.childForFieldName('object');
  if (!object) {
    // sem receptor: método da própria classe (ou herdado) — ou de um `import static`; no Java não há função solta
    const anonymous = anonymousBase(node);
    if (anonymous) return anonymous.length > 0 ? { name, receiver: { type: anonymous, rest: [] } } : { name, shadowed: true, opaque: true };
    const fromImport = statics?.members.get(name);
    const candidates = fromImport ? [fromImport] : statics?.wildcards ?? [];
    const cls = enclosingClass(node);
    if (!cls) return { name, ...(candidates.length > 0 && { statics: candidates }) };
    if (OBJECT_METHODS.has(name) && !declaresMethod(cls, name)) return { name, shadowed: true, opaque: true };
    return { name, receiver: { type: [className(cls)], rest: [] }, ...(candidates.length > 0 && { statics: candidates }) };
  }
  const chain = memberChain(object);
  if (chain) return { name, object: chain, ...receiverOf(node, chain, shapes) };
  let inner: SyntaxNode | null = object;
  while (inner?.type === 'parenthesized_expression') inner = inner.namedChildren[0] ?? null;
  if (inner?.type === 'method_invocation') {
    const desc = describeInvocation(inner, shapes);
    if (desc) return { name, receiver: { call: withArgs(inner, desc), rest: [] } };
  }
  if (inner?.type === 'object_creation_expression') {
    const type = declaredType(inner.childForFieldName('type'));
    if (type) return { name, receiver: { type, rest: [] } };
  }
  return { name, dynamic: true };
}

/** A classe declara um método com esse nome (no próprio corpo)? */
function declaresMethod(cls: SyntaxNode, name: string): boolean {
  return (cls.childForFieldName('body')?.namedChildren ?? []).some((m) => m.type === 'method_declaration' && m.childForFieldName('name')?.text === name);
}

function withArgs(node: SyntaxNode, desc: CallDesc): CallDesc {
  const args = argumentsOf(node).map((a) => describeArg(a, new Map()));
  return args.length > 0 ? { ...desc, args } : desc;
}

function argumentsOf(call: SyntaxNode): SyntaxNode[] {
  return (call.childForFieldName('arguments')?.namedChildren ?? []).filter((a) => a.type !== 'line_comment' && a.type !== 'block_comment');
}

function describeArg(arg: SyntaxNode, shapes: Map<number, ClassShape>): RawArg {
  const text = literalText(arg);
  if (text !== undefined) return { kind: 'string', value: text };
  if (arg.type === 'lambda_expression') return { kind: 'function' };
  // `Order.class`: a classe como valor (o `em.find(Order.class, id)` diz a entidade)
  if (arg.type === 'class_literal') {
    const type = javaType(arg.namedChildren[0]);
    if (type) return { kind: 'constant', chain: [...type, 'class'] };
  }
  if (arg.type === 'method_invocation') {
    const callee = memberChain(arg.childForFieldName('object'));
    const name = arg.childForFieldName('name')?.text;
    if (name) return { kind: 'call', callee: [...(callee ?? []), name] };
  }
  // `this::find` / `OrderService::find` / `service::find`: referência a método
  if (arg.type === 'method_reference') {
    const target = arg.namedChildren[0];
    const name = arg.namedChildren.at(-1);
    const head = memberChain(target);
    if (head && name?.type === 'identifier') {
      const chain = [...head, name.text];
      return { kind: 'name', chain, ref: { name: name.text, object: head, ...receiverOf(arg, head, shapes) } };
    }
    return { kind: 'other' };
  }
  const chain = memberChain(arg);
  if (!chain || chain[0] === 'super' || (chain.length === 1 && chain[0] === 'this')) return { kind: 'other' };
  const local = chain[0] === 'this' ? undefined : localOf(arg, chain[0]!);
  const ref: CallDesc = chain.length === 1 ? { name: chain[0]!, shadowed: true } : { name: chain.at(-1)!, object: chain.slice(0, -1), ...receiverOf(arg, chain.slice(0, -1), shapes) };
  return { kind: 'name', chain, ref, ...(local && { scope: local.scope }) };
}

/** Um valor de anotação: texto, lista (`{"/a", "/b"}`), constante (`RequestMethod.POST`) ou outro. */
function annotationValue(node: SyntaxNode): CallArg {
  const text = literalText(node);
  if (text !== undefined) return { kind: 'string', value: text };
  if (node.type === 'element_value_array_initializer') return { kind: 'array', items: node.namedChildren.map(annotationValue) };
  const chain = memberChain(node);
  return chain ? { kind: 'constant', chain } : { kind: 'other' };
}

/** Os argumentos de uma anotação: o valor posicional, e os pares `chave = valor` num `object` com `values`. */
function annotationArgs(annotation: SyntaxNode): RawArg[] {
  const list = annotation.childForFieldName('arguments');
  if (!list) return [];
  const pairs = list.namedChildren.filter((c) => c.type === 'element_value_pair');
  const positional = list.namedChildren.filter((c) => c.type !== 'element_value_pair' && c.type !== 'line_comment' && c.type !== 'block_comment');
  const out: RawArg[] = positional.map((v) => annotationValue(v) as RawArg);
  if (pairs.length > 0) {
    const values: Record<string, CallArg> = {};
    const texts: Record<string, { kind: 'string'; value: string }> = {};
    for (const p of pairs) {
      const key = p.childForFieldName('key')?.text;
      const value = p.childForFieldName('value');
      if (!key || !value) continue;
      values[key] = annotationValue(value);
      const t = values[key]!;
      if (t.kind === 'string') texts[key] = t;
    }
    out.push({ kind: 'object', keys: Object.keys(values), ...(Object.keys(texts).length > 0 && { texts }), values });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Símbolos e chamadas do arquivo

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of node.namedChildren) walk(child, visit);
}

function extractSymbols(root: SyntaxNode, fileId: string, pkg: string, shapes: Map<number, ClassShape>): SymbolInfo[] {
  const results: SymbolInfo[] = [];
  const push = (node: SyntaxNode, kind: SymbolKind, name: string, extra: Partial<SymbolInfo> = {}) => {
    const params = node.childForFieldName('parameters');
    const info: SymbolInfo = {
      id: '',
      kind,
      name,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      signature: params?.text,
      bodyHash: bodyHash(node, node.childForFieldName('name')),
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    };
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (info as unknown as Record<string, unknown>)[k] = v;
    results.push(info);
  };

  walk(root, (node) => {
    if (CLASS_TYPES.has(node.type) || isRepositoryInterface(node)) {
      const repository = node.type === 'interface_declaration';
      // repositório do Spring Data: a "base" é o repositório do Spring (ou a base do projeto), e a entidade é o 1º argumento
      const base = repository ? interfaceBases(node)[0] : node.type === 'class_declaration' ? superclassOf(node) : undefined;
      const interfaces = repository
        ? interfaceBases(node)
        : (node.childForFieldName('interfaces') ?? node.namedChildren.find((c) => c.type === 'super_interfaces'))?.namedChildren.find((c) => c.type === 'type_list')?.namedChildren ?? [];
      const implemented = interfaces.map((t) => javaType(t)?.at(-1)).filter((n): n is string => !!n);
      const shape = shapeOf(node, shapes);
      push(node, 'class', className(node), {
        namespace: pkg,
        container: outerClasses(node),
        extends: javaType(base),
        extendsArg: firstTypeArg(base),
        implements: implemented.length > 0 ? implemented : undefined,
        fields: Object.keys(shape.fields).length > 0 ? shape.fields : undefined,
        fieldArgs: Object.keys(shape.fieldArgs).length > 0 ? shape.fieldArgs : undefined,
        properties: shape.properties.length > 0 ? shape.properties : undefined,
      });
      // os métodos declarados num repositório são gerados pelo Spring: não viram símbolo
      return repository ? false : undefined;
    }
    if (TYPE_DECLARATIONS.has(node.type)) return false; // interface comum e anotação: sem corpo executável
    if (node.type === 'method_declaration' || node.type === 'constructor_declaration' || node.type === 'compact_constructor_declaration') {
      const cls = enclosingClass(node);
      const name = node.type === 'method_declaration' ? node.childForFieldName('name')?.text : cls ? className(cls) : undefined;
      if (!cls || !name) return;
      const type = node.type === 'method_declaration' ? node.childForFieldName('type') : undefined;
      push(node, 'method', name, { container: className(cls), returns: returnType(type), unwraps: unwrapped(type) });
    }
  });

  stableIds(results, fileId);
  return results;
}

function extractCalls(root: SyntaxNode, symbols: SymbolInfo[], fileId: string, shapes: Map<number, ClassShape>, statics: StaticImports): RawCall[] {
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
    if (node.type === 'method_invocation') {
      const caller = enclosing(node.startIndex) ?? fileId;
      const desc = describeInvocation(node, shapes, statics);
      if (!desc) return;
      const args = argumentsOf(node).map((a) => describeArg(a, shapes));
      results.push({ caller, ...desc, ...position(node), args });
      for (const arg of args) if (arg.kind === 'name' && !arg.ref.shadowed && !arg.ref.opaque) results.push({ caller, ...arg.ref, kind: 'ref' });
      return;
    }
    if (node.type === 'object_creation_expression') {
      const type = declaredType(node.childForFieldName('type'));
      if (!type) return;
      const caller = enclosing(node.startIndex) ?? fileId;
      results.push({ caller, name: type.at(-1)!, ctor: true, receiver: { type, rest: [] }, ...position(node), args: argumentsOf(node).map((a) => describeArg(a, shapes)) });
      return;
    }
    if (node.type === 'modifiers') {
      // anotações da classe ou do método: a chamada `decorates` o símbolo (as de parâmetro e de campo ficam de fora)
      const decorated = node.parent ? symbolAt.get(node.parent.startIndex) : undefined;
      if (!decorated) return false;
      for (const a of node.namedChildren.filter((c) => c.type === 'marker_annotation' || c.type === 'annotation')) {
        const type = javaType(a.childForFieldName('name'));
        if (!type) continue;
        results.push({ caller: decorated.id, name: type.at(-1)!, decorates: decorated.id, ...position(a), args: annotationArgs(a) });
      }
      return false;
    }
  });
  return results;
}

/**
 * Os tipos de fora que o arquivo importa viram ligações para o pacote deles (`JpaRepository` → Spring Data):
 * `import x.y.Tipo;` de um prefixo conhecido, ou `import x.y.*;` de um prefixo conhecido para os nomes da lista
 * que o arquivo usa. Um tipo declarado no próprio arquivo com o mesmo nome não vira ligação.
 */
function moduleInfo(root: SyntaxNode, imports: Array<{ qualified: string; wildcard: boolean }>): ModuleInfo {
  const declared = new Set<string>();
  const used = new Set<string>();
  walk(root, (n) => {
    if (TYPE_DECLARATIONS.has(n.type)) {
      const name = n.childForFieldName('name')?.text;
      if (name) declared.add(name);
    }
    if (n.type === 'type_identifier' || n.type === 'identifier') used.add(n.text);
    return n.type !== 'import_declaration' && n.type !== 'package_declaration';
  });
  const known = (name: string, pkgOf: string) => {
    const ext = Object.hasOwn(JAVA_EXTERNAL_TYPES, name) ? JAVA_EXTERNAL_TYPES[name] : undefined;
    return ext && ext.prefixes.some((p) => pkgOf === p || pkgOf.startsWith(`${p}.`)) ? ext : undefined;
  };
  const bindings = new Map<string, ImportBinding>();
  for (const imp of imports) {
    if (imp.wildcard) {
      for (const name of used) {
        const ext = known(name, imp.qualified);
        if (ext && !declared.has(name) && !bindings.has(name)) bindings.set(name, { local: name, imported: name, spec: ext.pkg });
      }
      continue;
    }
    const dot = imp.qualified.lastIndexOf('.');
    const name = imp.qualified.slice(dot + 1);
    const ext = known(name, imp.qualified.slice(0, dot));
    if (ext && !declared.has(name)) bindings.set(name, { local: name, imported: name, spec: ext.pkg });
  }
  const list = [...bindings.values()].sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  return {
    specs: [...new Set(list.map((b) => b.spec))].sort(),
    imports: list,
    exports: new Map(),
    reexports: [],
    valueTypes: new Map(),
    objectRefs: new Map(),
    arrays: new Map(),
    aliases: new Map(),
    objectRequires: new Map(),
  };
}

/** Tudo o que o grafo guarda de um arquivo Java. */
export function extractJava(root: SyntaxNode, fileId: string): FileExtraction {
  const { scope, pkg, imports } = packageScope(root);
  const shapes = new Map<number, ClassShape>();
  const symbols = extractSymbols(root, fileId, pkg, shapes);
  return {
    symbols,
    module: moduleInfo(root, imports),
    valueCalls: new Map(),
    calls: extractCalls(root, symbols, fileId, shapes, staticImports(root)),
    topHash: topLevelHash(root, symbols),
    scope,
  };
}
