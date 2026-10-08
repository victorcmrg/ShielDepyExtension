// Tabela de módulo de um arquivo TS/JS: o que ele importa (com o nome LOCAL de cada ligação),
// o que exporta e o que re-exporta. É o que permite resolver `import { a as b }`, `import * as ns`,
// `export default`, barrels (`export * from`) e CommonJS (`require`/`module.exports`) — antes as
// chamadas eram ligadas só pelo nome, e qualquer alias ou barrel quebrava a cadeia.
// Função pura: não sabe nada de disco nem do grafo.

import { constructedType, typeRef, type TypeRef } from './ast';
import type { SyntaxNode } from './parser';

/** Ligação local criada por um import. `imported` é o nome exportado, `default` ou `*` (namespace/require). */
export interface ImportBinding {
  local: string;
  imported: string;
  spec: string;
}

/** `export { a as b } from './x'` → {exported:'b', imported:'a'}; `export * from` → {exported:'*', imported:'*'}. */
export interface ReExport {
  exported: string;
  imported: string;
  spec: string;
}

export interface ModuleInfo {
  /** Todos os especificadores (relativos, aliases e pacotes), sem repetição, na ordem do arquivo. */
  specs: string[];
  imports: ImportBinding[];
  /** Nome exportado → nome local (`default` → nome do símbolo ou `default` quando anônimo). */
  exports: Map<string, string>;
  reexports: ReExport[];
  /**
   * Tipo das instâncias declaradas no topo do arquivo: `export const orderService = new OrderService()`
   * → orderService: ['OrderService']. É o que liga `orderService.create()` em OUTRO arquivo ao método.
   */
  valueTypes: Map<string, TypeRef>;
}

/** Nome dado ao símbolo de `export default function () {}` / `export default () => {}`. */
export const DEFAULT_EXPORT_NAME = 'default';

const FUNCTION_VALUE_TYPES = new Set(['arrow_function', 'function_expression', 'function']);

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of node.namedChildren) walk(child, visit);
}

function stringValue(node: SyntaxNode | null | undefined): string | undefined {
  if (!node || (node.type !== 'string' && node.type !== 'template_string')) return undefined;
  if (node.type === 'template_string' && node.namedChildren.some((c) => c.type === 'template_substitution')) return undefined;
  return node.text.slice(1, -1);
}

function hasToken(node: SyntaxNode, token: string): boolean {
  return node.children.some((c) => c.type === token);
}

/** `require('x')` → 'x'. */
function requireSpec(node: SyntaxNode | null): string | undefined {
  if (node?.type !== 'call_expression') return undefined;
  const fn = node.childForFieldName('function');
  if (fn?.type !== 'identifier' || fn.text !== 'require') return undefined;
  return stringValue(node.childForFieldName('arguments')?.namedChildren[0]);
}

/** `module.exports` ou `exports` (lado esquerdo de uma atribuição CommonJS). */
function isModuleExports(node: SyntaxNode | null): boolean {
  if (!node) return false;
  if (node.type === 'identifier') return node.text === 'exports';
  return (
    node.type === 'member_expression' &&
    node.childForFieldName('object')?.text === 'module' &&
    node.childForFieldName('property')?.text === 'exports'
  );
}

function declaredNames(decl: SyntaxNode): string[] {
  const name = decl.childForFieldName('name');
  if (name) return [name.text];
  // lexical_declaration / variable_declaration: `export const a = 1, b = 2`
  return decl.namedChildren
    .filter((c) => c.type === 'variable_declarator')
    .map((c) => c.childForFieldName('name'))
    .filter((n): n is SyntaxNode => n?.type === 'identifier')
    .map((n) => n.text);
}

export function extractModuleInfo(root: SyntaxNode): ModuleInfo {
  const specs: string[] = [];
  const imports: ImportBinding[] = [];
  const exports = new Map<string, string>();
  const reexports: ReExport[] = [];
  const addSpec = (spec: string) => {
    if (!specs.includes(spec)) specs.push(spec);
  };

  walk(root, (node) => {
    switch (node.type) {
      case 'import_statement': {
        const spec = stringValue(node.childForFieldName('source'));
        if (spec === undefined) return false;
        addSpec(spec);
        const clause = node.namedChildren.find((c) => c.type === 'import_clause');
        for (const part of clause?.namedChildren ?? []) {
          if (part.type === 'identifier') imports.push({ local: part.text, imported: 'default', spec });
          else if (part.type === 'namespace_import') {
            const id = part.namedChildren.find((c) => c.type === 'identifier');
            if (id) imports.push({ local: id.text, imported: '*', spec });
          } else if (part.type === 'named_imports') {
            for (const s of part.namedChildren) {
              if (s.type !== 'import_specifier') continue;
              const name = s.childForFieldName('name')?.text;
              const alias = s.childForFieldName('alias')?.text;
              if (name) imports.push({ local: alias ?? name, imported: name, spec });
            }
          }
        }
        return false;
      }

      case 'export_statement': {
        const spec = stringValue(node.childForFieldName('source'));
        const isDefault = hasToken(node, 'default');
        const clause = node.namedChildren.find((c) => c.type === 'export_clause');
        if (spec !== undefined) {
          addSpec(spec);
          const nsExport = node.namedChildren.find((c) => c.type === 'namespace_export');
          if (clause) {
            for (const s of clause.namedChildren) {
              const name = s.childForFieldName('name')?.text;
              if (name) reexports.push({ exported: s.childForFieldName('alias')?.text ?? name, imported: name, spec });
            }
          } else if (nsExport) {
            const id = nsExport.namedChildren[0];
            if (id) reexports.push({ exported: id.text, imported: '*', spec });
          } else {
            reexports.push({ exported: '*', imported: '*', spec });
          }
          return false;
        }
        if (clause) {
          for (const s of clause.namedChildren) {
            const name = s.childForFieldName('name')?.text;
            if (name) exports.set(s.childForFieldName('alias')?.text ?? name, name);
          }
          return false;
        }
        const decl = node.childForFieldName('declaration');
        if (decl) {
          const names = declaredNames(decl);
          for (const n of names) exports.set(n, n);
          if (isDefault && names[0]) exports.set('default', names[0]);
          return true; // a declaração pode conter `require` (export const x = require(...))
        }
        const value = node.childForFieldName('value');
        if (isDefault && value) {
          if (value.type === 'identifier') exports.set('default', value.text);
          else {
            const name = value.childForFieldName('name')?.text;
            exports.set('default', name ?? DEFAULT_EXPORT_NAME);
          }
        }
        return true;
      }

      case 'variable_declarator': {
        const spec = requireSpec(node.childForFieldName('value'));
        if (spec === undefined) return true;
        addSpec(spec);
        const name = node.childForFieldName('name');
        if (name?.type === 'identifier') imports.push({ local: name.text, imported: '*', spec });
        else if (name?.type === 'object_pattern') {
          for (const p of name.namedChildren) {
            if (p.type === 'shorthand_property_identifier_pattern') imports.push({ local: p.text, imported: p.text, spec });
            else if (p.type === 'pair_pattern') {
              const key = p.childForFieldName('key')?.text;
              const value = p.childForFieldName('value');
              if (key && value?.type === 'identifier') imports.push({ local: value.text, imported: key, spec });
            }
          }
        }
        return false;
      }

      case 'call_expression': {
        // `require('./x')` solto (efeito colateral) ainda é uma dependência.
        const spec = requireSpec(node);
        if (spec !== undefined) addSpec(spec);
        return true;
      }

      case 'assignment_expression': {
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (!left || !right) return true;
        if (isModuleExports(left)) {
          // module.exports = { a, b: c }   |   module.exports = fn
          if (right.type === 'object') {
            for (const p of right.namedChildren) {
              if (p.type === 'shorthand_property_identifier') exports.set(p.text, p.text);
              else if (p.type === 'pair') {
                const key = p.childForFieldName('key')?.text;
                const value = p.childForFieldName('value');
                if (key && value?.type === 'identifier') exports.set(key, value.text);
                else if (key && value && FUNCTION_VALUE_TYPES.has(value.type)) exports.set(key, key);
              }
            }
          } else if (right.type === 'identifier') exports.set('default', right.text);
          else if (right.type === 'class' || FUNCTION_VALUE_TYPES.has(right.type)) {
            exports.set('default', right.childForFieldName('name')?.text ?? DEFAULT_EXPORT_NAME);
          }
          return true;
        }
        // exports.a = ...   |   module.exports.a = ...
        if (left.type === 'member_expression' && isModuleExports(left.childForFieldName('object'))) {
          const key = left.childForFieldName('property')?.text;
          if (key) exports.set(key, right.type === 'identifier' ? right.text : key);
        }
        return true;
      }
    }
    return true;
  });

  const valueTypes = new Map<string, TypeRef>();
  for (const stmt of root.namedChildren) {
    const inner = stmt.type === 'export_statement' ? stmt.childForFieldName('declaration') ?? stmt.childForFieldName('value') : stmt;
    if (!inner) continue;
    if (stmt.type === 'export_statement' && inner === stmt.childForFieldName('value')) {
      const type = constructedType(inner); // export default new OrderService()
      if (type) valueTypes.set('default', type);
      continue;
    }
    if (inner.type !== 'lexical_declaration' && inner.type !== 'variable_declaration') continue;
    for (const d of inner.namedChildren) {
      const name = d.type === 'variable_declarator' ? d.childForFieldName('name') : undefined;
      if (name?.type !== 'identifier') continue;
      const type = typeRef(d.childForFieldName('type')) ?? constructedType(d.childForFieldName('value'));
      if (type) valueTypes.set(name.text, type);
    }
  }

  return { specs, imports, exports, reexports, valueTypes };
}
