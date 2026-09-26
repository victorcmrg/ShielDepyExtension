// Leitura leve (regex) de CSS e HTML — sem gramática Tree-sitter, pra não depender de mais .wasm.
// Funções puras: devolvem o que foi achado; o CodeGraph liga isso no grafo.

import * as path from 'node:path';
import type { HtmlUsage } from './types';

/** Seletores `.classe`/`#id` definidos e `@import` referenciados por um CSS. */
export function parseCss(text: string): { selectors: string[]; imports: string[] } {
  // Sem comentários, e só o que vem ANTES de `{` é seletor — senão `color: #fff` virava "#fff".
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const selectorRegex = /(^|[\s,>+~(])([.#][a-zA-Z_-][\w-]*)/g;
  const selectors = new Set<string>();
  for (const block of clean.matchAll(/([^{}]*)\{/g)) {
    const prelude = block[1]!;
    if (prelude.trim().startsWith('@')) continue; // @media/@supports: o seletor vem no bloco de dentro
    for (const match of prelude.matchAll(selectorRegex)) selectors.add(match[2]!);
  }
  const imports = [...clean.matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)["']?\)?/g)].map((m) => m[1]!);
  return { selectors: [...selectors], imports };
}

/**
 * `class=`/`id=` usados (com a linha da 1ª ocorrência) e os `<link href>`/`<script src>` —
 * é o que permite cruzar "o HTML usa `.x`, mas nenhum CSS vinculado define `.x`".
 */
export function parseHtml(text: string): { usages: HtmlUsage[]; refs: string[] } {
  const usages: HtmlUsage[] = [];
  const seen = new Set<string>();
  let line = 0;
  let cursor = 0;
  for (const match of text.matchAll(/\b(class|id)\s*=\s*["']([^"']+)["']/gi)) {
    while (cursor < match.index!) {
      if (text.charCodeAt(cursor) === 10) line++;
      cursor++;
    }
    const prefix = match[1]!.toLowerCase() === 'id' ? '#' : '.';
    for (const token of match[2]!.split(/\s+/).filter(Boolean)) {
      const key = prefix + token;
      if (seen.has(key)) continue;
      seen.add(key);
      usages.push({ token: key, line });
    }
  }
  const refs = [...text.matchAll(/<(?:link[^>]*\shref|script[^>]*\ssrc)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]!);
  return { usages, refs };
}

/** Caminho em disco de uma referência relativa de HTML/CSS; `undefined` pra URL externa ou `data:`. */
export function resolveWebRef(fromFsPath: string, ref: string): string | undefined {
  if (/^([a-z]+:)?\/\//i.test(ref) || ref.startsWith('data:')) return undefined;
  const clean = ref.split('#')[0]!.split('?')[0];
  if (!clean) return undefined;
  return path.normalize(path.join(path.dirname(fromFsPath), clean));
}
