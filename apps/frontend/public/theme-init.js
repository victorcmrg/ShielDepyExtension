// Aplica o tema claro/escuro ANTES do primeiro desenho (script bloqueante no <head>; inline não
// passaria na CSP). Mesma chave de localStorage do site oficial (lib/theme.ts), pra quem já visitou
// abrir aqui no tema certo. A troca depois fica com src/shared/theme.ts.
(function () {
  var KEY = 'shieldpy.theme';
  var theme;
  try {
    theme = localStorage.getItem(KEY);
  } catch (e) {
    /* localStorage indisponível (aba privada) */
  }
  if (theme !== 'light' && theme !== 'dark') theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch (e) {
    /* segue só na sessão atual */
  }
})();
