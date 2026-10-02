// Gate de login compartilhado pelas páginas logadas (app, admin, account): busca
// /api/auth/me, manda pro login se não tiver sessão, e preenche a barra de conta.
// Só revela o <main> depois da checagem — evita flash de conteúdo pra quem não está logado.
//   <body data-require-access>  → além de logado, exige a empresa com acesso liberado
//   <body data-require-admin>   → exige conta admin (senão vai pro painel da conta)
window.shieldepyAuth = (function () {
  let cached = null;

  async function fetchMe() {
    if (cached) return cached;
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) return null;
    cached = await res.json();
    return cached;
  }

  function homeFor(me) {
    return me.isAdmin ? '/admin.html' : '/account.html';
  }

  function navLink(href, label, active) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    a.className = 'nav-pill' + (active ? ' active' : '');
    return a;
  }

  function renderNav(me) {
    const nav = document.getElementById('accountNav');
    if (!nav) return;
    nav.replaceChildren();
    const here = location.pathname;
    nav.appendChild(navLink(homeFor(me), me.isAdmin ? 'Painel admin' : 'Minha conta', here === homeFor(me)));
    nav.appendChild(navLink('/app.html', 'Ferramenta', here === '/app.html'));

    const who = document.createElement('span');
    who.className = 'account-email';
    who.textContent = me.email;
    who.title = me.companyName;
    nav.appendChild(who);

    const logout = document.createElement('button');
    logout.textContent = 'Sair';
    logout.className = 'nav-pill';
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/login.html';
    });
    nav.appendChild(logout);
  }

  function renderBlocked(me) {
    const main = document.getElementById('main');
    if (!main) return;
    main.replaceChildren();
    main.className = 'blocked-wrap';
    const card = document.createElement('div');
    card.className = 'blocked-card enter';
    card.innerHTML =
      '<div class="blocked-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5.2" y="10.8" width="13.6" height="9.5" rx="2.4"/><path d="M8 10.8V7.8a4 4 0 0 1 8 0v3"/></svg></div>';
    const h = document.createElement('h2');
    h.textContent = 'Acesso da empresa suspenso';
    const p = document.createElement('p');
    p.textContent = 'O acesso de "' + me.companyName + '" à ferramenta está suspenso no momento. Fale com o administrador da sua conta para reativar.';
    const back = document.createElement('a');
    back.href = homeFor(me);
    back.className = 'btn-brand';
    back.textContent = 'Voltar para o painel';
    card.append(h, p, back);
    main.appendChild(card);
  }

  /** Redireciona pro login se não houver sessão. Opções vêm dos data-attributes do <body>. */
  async function requireLogin() {
    const me = await fetchMe();
    if (!me) {
      window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname);
      return null;
    }
    if (document.body.hasAttribute('data-require-admin') && !me.isAdmin) {
      window.location.href = '/account.html';
      return null;
    }
    renderNav(me);
    const main = document.getElementById('main');
    if (document.body.hasAttribute('data-require-access') && me.permissions && me.permissions.accessEnabled === false) {
      renderBlocked(me);
      if (main) main.classList.remove('gated-hidden');
      return null;
    }
    if (main) main.classList.remove('gated-hidden');
    return me;
  }

  return { fetchMe, requireLogin, homeFor };
})();

window.shieldepyTheme.mount();
window.shieldepyAuthReady = window.shieldepyAuth.requireLogin();
