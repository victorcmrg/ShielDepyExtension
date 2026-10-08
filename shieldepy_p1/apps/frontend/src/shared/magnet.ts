// Botões com ímã: chegam um pouco em direção ao cursor. Um único listener delegado no document pega
// qualquer botão que o React desenhar, sem um efeito por componente. O deslocamento vai em --tx/--ty
// e a classe .magnetic (CSS) aplica o translate.
const SELECTOR = [
  'button:not(:disabled)', '.button', '.icon-button', '.link-quiet', '.vid-play', '.scroll-cue',
  '.btn-brand', '.btn-ghost', '.btn-danger', '.btn-pill', '.btn-secondary',
  '.nav .brand', '.nav-links a', '.footer nav a', '.footer .brand',
].join(', ');
const SKIP = '.billing button, [data-no-magnet]'; // a pílula deslizante do toggle não acompanharia

let installed = false;

export function installMagnet(): void {
  if (installed || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  installed = true;

  let active: HTMLElement | null = null;
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  function release() {
    if (!active) return;
    active.style.setProperty('--tx', '0px');
    active.style.setProperty('--ty', '0px');
    active = null;
  }
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      const b = (e.target as Element | null)?.closest?.<HTMLElement>(SELECTOR);
      if (!b || b.matches(SKIP)) return release();
      if (b !== active) {
        release();
        active = b;
      }
      // a cada movimento: se o React reescreveu o className do botão, a classe volta
      b.classList.add('magnetic');
      const r = b.getBoundingClientRect();
      // limita o deslocamento pra botões largos (block) não saírem voando
      b.style.setProperty('--tx', clamp((e.clientX - r.left - r.width / 2) * 0.22, 14).toFixed(1) + 'px');
      b.style.setProperty('--ty', clamp((e.clientY - r.top - r.height / 2) * 0.3, 8).toFixed(1) + 'px');
    },
    { passive: true }
  );
  document.addEventListener('pointerleave', release);
}
