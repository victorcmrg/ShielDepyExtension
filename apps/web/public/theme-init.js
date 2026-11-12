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
  // /entrar abre com um 404 de mentira em fundo branco (decisão 0039): marca já aqui, antes do CSS do
  // portal pintar o fundo do tema; a página tira a marca quando a reconstrução começa.
  if (location.pathname === '/entrar') document.documentElement.dataset.boot = '404';
  // modo leve da landing (decisão 0042): celular, poucos núcleos, pouca memória ou economia de dados.
  // Marcado aqui para valer já no primeiro quadro (o vigia em src/landing/perf.ts também liga se os
  // quadros vierem lentos).
  var nav = navigator;
  var conn = nav.connection;
  var coarse = window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(max-width: 900px)').matches;
  if (coarse || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4) || (nav.deviceMemory && nav.deviceMemory <= 4) || (conn && conn.saveData)) {
    document.documentElement.classList.add('lite');
  }
  try {
    localStorage.setItem(KEY, theme);
  } catch (e) {
    /* segue só na sessão atual */
  }
})();
