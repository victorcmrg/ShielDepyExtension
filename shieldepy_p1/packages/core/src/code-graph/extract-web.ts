// Leitura de CSS e HTML pela AST do Tree-sitter (gramáticas `css` e `html`) — sem regex.
// Funções puras: devolvem o que foi achado; o CodeGraph liga isso no grafo.

import * as path from 'node:path';
import type { SyntaxNode } from './parser';
import type { HtmlUsage } from './types';

function walk(node: SyntaxNode, visit: (n: SyntaxNode) => void): void {
  visit(node);
  for (const child of node.namedChildren) walk(child, visit);
}

function unquote(text: string): string {
  const first = text[0];
  return (first === '"' || first === "'") && text.endsWith(first) ? text.slice(1, -1) : text;
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

function splitWhitespace(value: string): string[] {
  const out: string[] = [];
  let current = '';
  for (const c of value) {
    if (isSpace(c)) {
      if (current) out.push(current);
      current = '';
    } else current += c;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Seletores `.classe`/`#id` definidos e `@import` referenciados por um CSS. Só conta o que está
 * na lista de seletores de uma regra (inclusive dentro de `@media`) — `color: #fff` e o `hover`
 * de `.a:hover` nunca viram seletor.
 */
export function parseCss(root: SyntaxNode): { selectors: string[]; imports: string[] } {
  const selectors = new Set<string>();
  const imports: string[] = [];
  walk(root, (node) => {
    if (node.type === 'class_selector') {
      const name = node.namedChildren.filter((c) => c.type === 'class_name').at(-1);
      if (name) selectors.add('.' + name.text);
    } else if (node.type === 'id_selector') {
      const name = node.namedChildren.find((c) => c.type === 'id_name');
      if (name) selectors.add('#' + name.text);
    } else if (node.type === 'import_statement') {
      // @import "x.css";   |   @import url("x.css");   |   @import url(x.css);
      let target: SyntaxNode | undefined = node.namedChildren[0];
      if (target?.type === 'call_expression') target = target.namedChildren.find((c) => c.type === 'arguments')?.namedChildren[0];
      if (target && (target.type === 'string_value' || target.type === 'plain_value')) imports.push(unquote(target.text));
    }
  });
  return { selectors: [...selectors], imports };
}

/** Valor de um atributo HTML (com ou sem aspas). */
function attributeValue(attr: SyntaxNode): string | undefined {
  const value = attr.namedChildren.find((c) => c.type === 'quoted_attribute_value' || c.type === 'attribute_value');
  if (!value) return undefined;
  if (value.type === 'attribute_value') return value.text;
  return value.namedChildren.find((c) => c.type === 'attribute_value')?.text ?? '';
}

/**
 * `class=`/`id=` usados (com a linha da 1ª ocorrência) e os `<link href>`/`<script src>` —
 * é o que permite cruzar "o HTML usa `.x`, mas nenhum CSS vinculado define `.x`".
 * Comentários HTML são nós próprios na AST, então nunca contam.
 */
export function parseHtml(root: SyntaxNode): { usages: HtmlUsage[]; refs: string[] } {
  const usages: HtmlUsage[] = [];
  const refs: string[] = [];
  const seen = new Set<string>();
  walk(root, (node) => {
    if (node.type !== 'start_tag' && node.type !== 'self_closing_tag') return;
    const tag = node.namedChildren.find((c) => c.type === 'tag_name')?.text.toLowerCase();
    for (const attr of node.namedChildren) {
      if (attr.type !== 'attribute') continue;
      const name = attr.namedChildren.find((c) => c.type === 'attribute_name')?.text.toLowerCase();
      const value = attributeValue(attr);
      if (!name || value === undefined) continue;
      if (name === 'class' || name === 'id') {
        const prefix = name === 'id' ? '#' : '.';
        for (const token of splitWhitespace(value)) {
          const key = prefix + token;
          if (seen.has(key)) continue;
          seen.add(key);
          usages.push({ token: key, line: attr.startPosition.row });
        }
      } else if ((tag === 'link' && name === 'href') || (tag === 'script' && name === 'src')) {
        refs.push(value);
      }
    }
  });
  return { usages, refs };
}

const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** `https://x`, `//cdn.x`, `data:...` — referência que não é arquivo do projeto. */
function isExternalRef(ref: string): boolean {
  if (ref.startsWith('//') || ref.startsWith('data:')) return true;
  const colon = ref.indexOf(':');
  return colon > 0 && [...ref.slice(0, colon)].every(isLetter) && ref.startsWith('//', colon + 1);
}

/** Caminho em disco de uma referência relativa de HTML/CSS; `undefined` pra URL externa ou `data:`. */
export function resolveWebRef(fromFsPath: string, ref: string): string | undefined {
  if (isExternalRef(ref)) return undefined;
  const clean = ref.split('#')[0]!.split('?')[0];
  if (!clean) return undefined;
  return path.normalize(path.join(path.dirname(fromFsPath), clean));
}
