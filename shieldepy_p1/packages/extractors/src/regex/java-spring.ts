// Extrator Java / Spring. Acha métodos anotados com @EventListener.
//   @EventListener
//   public void onOrderUpdated(OrderUpdated e) { e.setTotal(e.getSubtotal()...); }
// evento = tipo do parâmetro; recurso = evento sem o sufixo verbal ("OrderUpdated"->"Order").
// lê/escreve = getters/setters chamados no parâmetro (e.getX / e.setX).

import type { ParsedRule } from '../types';
import { braceBlock, deriveResource, getterSetterAccess, lineAt, stripCComments } from './text';

const HANDLER_RE =
  /@EventListener\b(?:\s*\([^)]*\))?\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|protected|static|final|synchronized)\s+)*(?:void|[\w.<>]+)\s+\w+\s*\(\s*(?:final\s+)?(?:@\w+\s+)?([A-Za-z_][\w.]*)\s+(\w+)\s*\)\s*(?:throws\s+[\w.,\s]+)?\{/g;

export function parseJava(source: string): ParsedRule[] {
  const clean = stripCComments(source);
  const out: ParsedRule[] = [];

  for (const m of clean.matchAll(HANDLER_RE)) {
    const event = m[1]!.split('.').pop()!;
    const param = m[2]!;
    const openIdx = m.index! + m[0].length - 1;
    const body = braceBlock(clean, openIdx);
    const { reads, writes } = getterSetterAccess(body, param);
    out.push({ event, resource: deriveResource(event), reads, writes, line: lineAt(clean, m.index!) });
  }

  return out;
}
