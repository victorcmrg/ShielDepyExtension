// O selo do arquivo no Explorer (puro, sem `vscode`: testável).
import type { FindingSeverity } from '@shieldepy/core';

const GLYPH: Record<FindingSeverity, string> = { error: '■', warning: '▲', info: '●' };

/**
 * As formas de cada tipo presente, da mais grave para a mais leve (■▲, ▲●…). O VS Code aceita no
 * máximo 2 caracteres no selo, então com os três tipos ficam os dois mais graves; a contagem vem ao
 * lado, do próprio VS Code (os diagnósticos), e a dica do arquivo traz os números de cada tipo.
 */
export function badgeFor(counts: Record<FindingSeverity, number>): string {
  return (['error', 'warning', 'info'] as FindingSeverity[])
    .filter((s) => counts[s] > 0)
    .slice(0, 2)
    .map((s) => GLYPH[s])
    .join('');
}
