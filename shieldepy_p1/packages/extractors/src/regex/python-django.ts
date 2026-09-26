// Extrator Python / Django. Acha receivers de signals:
//   @receiver(pre_save, sender=Order)
//   def apply_tax(sender, instance, **kwargs):
//       instance.total = instance.subtotal * 1.1
// evento = o signal (pre_save); recurso = o sender (Order).
// lê/escreve = acessos ao parâmetro da instância no corpo (indentado).

import type { ParsedRule } from '../types';
import { dotFieldAccess, lineAt, stripHashComments } from './text';

const RECEIVER_RE =
  /@receiver\s*\(\s*([A-Za-z_][\w.]*)\s*,\s*sender\s*=\s*([A-Za-z_][\w.]*)\s*\)\s*\n(?:\s*@[^\n]*\n)*\s*def\s+\w+\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:/g;

export function parsePython(source: string): ParsedRule[] {
  const clean = stripHashComments(source);
  const out: ParsedRule[] = [];

  for (const m of clean.matchAll(RECEIVER_RE)) {
    const event = m[1]!.split('.').pop()!;
    const resource = m[2]!.split('.').pop()!;
    const param = instanceParam(m[3]!);
    const body = indentedBody(clean, m.index! + m[0].length);
    const { reads, writes } = dotFieldAccess(body, param);
    out.push({ event, resource, reads, writes, line: lineAt(clean, m.index!) });
  }

  return out;
}

/**
 * Nome do parâmetro que recebe a instância. Pela convenção do Django é `instance` (passado por
 * keyword); se não houver, é o segundo posicional depois de `sender`.
 */
function instanceParam(params: string): string {
  const names = params
    .split(',')
    .map((p) => p.trim().split(/[:=]/)[0]!.trim())
    .filter((p) => p && !p.startsWith('*'));
  if (names.includes('instance')) return 'instance';
  return names[1] ?? 'instance';
}

/** Corpo de uma função Python: do fim da linha `def ...:` até a próxima linha em coluna 0. */
function indentedBody(src: string, fromIdx: number): string {
  const rest = src.slice(fromIdx);
  const end = rest.search(/\n(?=\S)/);
  return end === -1 ? rest : rest.slice(0, end);
}
