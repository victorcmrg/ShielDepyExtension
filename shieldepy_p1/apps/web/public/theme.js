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
