import type { CSSProperties } from 'react';

export const reduceMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return 'nunca';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  const d = Math.round(h / 24);
  if (d < 30) return 'há ' + d + (d === 1 ? ' dia' : ' dias');
  return new Date(ts).toLocaleDateString('pt-BR');
}

export function formatDate(ts: number | null | undefined): string {
  return ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export const initial = (text: string): string => text.charAt(0).toUpperCase();

/**
 * Entrada escalonada dos cards: junte a classe `enter` ao elemento e passe este style (o CSS lê --i
 * pra atrasar cada um). Teto de 12 pra lista longa não demorar a aparecer.
 */
export const staggerStyle = (i: number): CSSProperties => ({ '--i': String(Math.min(i, 12)) }) as CSSProperties;
