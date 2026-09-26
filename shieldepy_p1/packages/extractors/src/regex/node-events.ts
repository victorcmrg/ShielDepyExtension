// Extrator Node (event bus) por regex — FALLBACK do extrator Tree-sitter.
// Acha handlers `bus.on('evento', (param) => { ... })` e o que cada um LÊ e ESCREVE.
// NÃO cobre destructuring de parâmetro, alias, handler nomeado, etc. — isso o Tree-sitter cobre.

import type { ParsedRule } from '../types';
import { braceBlock, dotFieldAccess, lineAt, prefixResource, stripCComments } from './text';

// cabeçalho do handler: [algo.]on[<Genérico>]('evento', [async] (param) => {
const HEADER_RE =
  /\bon\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*(?:async\s*)?\(?\s*([a-zA-Z_]\w*)?\s*\)?\s*=>\s*\{/g;

export function parseNodeHandlers(source: string): ParsedRule[] {
  const clean = stripCComments(source);
  const out: ParsedRule[] = [];

  for (const m of clean.matchAll(HEADER_RE)) {
    const event = m[2]!;
    const param = m[3] ?? '';
    const openIdx = clean.indexOf('{', m.index! + m[0].length - 1);
    const body = braceBlock(clean, openIdx);
    const { reads, writes } = dotFieldAccess(body, param);
    out.push({ event, resource: prefixResource(event), reads, writes, line: lineAt(clean, m.index!) });
  }

  return out;
}
