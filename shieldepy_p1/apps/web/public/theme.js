// Alterna claro/escuro via atributo data-theme na <html>, igual ao lib/theme.ts do
// site oficial — mesma chave de localStorage, pra quem já visitou o site principal
// abrir aqui já no tema certo.
window.shieldepyTheme = (function () {
  const KEY = 'shieldpy.theme';

  function initial() {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* localStorage indisponível (aba privada) — segue só na sessão atual */
    }
  }

  let current = initial();
  apply(current);

  function toggle() {
    current = current === 'dark' ? 'light' : 'dark';
    apply(current);
    renderIcon();
  }

  function renderIcon() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.innerHTML =
      current === 'dark'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3.5 12h2M18.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="1.5"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    btn.setAttribute('aria-label', current === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
  }

  /** Chame depois de inserir o botão #themeToggle no DOM. */
  function mount() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    renderIcon();
    btn.addEventListener('click', toggle);
  }

  return { mount };
})();

// Botões com ímã: chegam um pouco em direção ao cursor. Delegado no document pra
// pegar também os botões que as páginas do painel desenham via JS.
(function () {
  const SELECTOR = [
    'button:not(:disabled)', '.button', '.icon-button', '.link-quiet', '.vid-play', '.scroll-cue',
    '.btn-brand', '.btn-ghost', '.btn-danger', '.btn-pill', '.btn-secondary',
    '.nav .brand', '.nav-links a', '.footer nav a', '.footer .brand',
  ].join(', ');
  const SKIP = '.billing button, [data-no-magnet]'; // a pílula deslizante do toggle não acompanharia
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let active = null;
  const clamp = (v, m) => Math.max(-m, Math.min(m, v));
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
      const b = e.target.closest && e.target.closest(SELECTOR);
      if (!b || b.matches(SKIP)) return release();
      if (b !== active) {
        release();
        active = b;
        b.classList.add('magnetic');
      }
      const r = b.getBoundingClientRect();
      // limita o deslocamento pra botões largos (block) não saírem voando
      b.style.setProperty('--tx', clamp((e.clientX - r.left - r.width / 2) * 0.22, 14).toFixed(1) + 'px');
      b.style.setProperty('--ty', clamp((e.clientY - r.top - r.height / 2) * 0.3, 8).toFixed(1) + 'px');
    },
    { passive: true }
  );
  document.addEventListener('pointerleave', release);
})();
