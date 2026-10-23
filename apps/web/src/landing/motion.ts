// Utilitários de movimento da landing. Nada aqui roda no import (a landing também é renderizada no
// build, em Node, sem window).

export const clamp = (n: number, a = 0, b = 1): number => Math.min(Math.max(n, a), b);
export const ease = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

let reduce: boolean | undefined;
/** prefers-reduced-motion, lido uma vez por página (como o original). */
export function reduceMotion(): boolean {
  reduce ??= window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduce;
}

/**
 * Escreve um estilo só se mudou. Os valores vão no elemento que usa o valor (não num pai com muitos
 * filhos): variável CSS num pai obriga o navegador a recalcular o estilo de todo o ramo a cada quadro.
 */
export function put(el: HTMLElement | SVGElement | null | undefined, prop: string, val: string): void {
  if (el && el.style.getPropertyValue(prop) !== val) el.style.setProperty(prop, val);
}

export function idle(cb: () => void, timeout: number): void {
  if ('requestIdleCallback' in window) window.requestIdleCallback(cb, { timeout });
  else setTimeout(cb, 16);
}

/** Índice de cada filho em --i (o CSS escalona a entrada por ele). */
export function indexChildren(parent: Element, selector?: string): void {
  const items = selector ? parent.querySelectorAll<HTMLElement>(selector) : (parent.children as HTMLCollectionOf<HTMLElement>);
  Array.from(items).forEach((el, i) => el.style.setProperty('--i', String(i)));
}
