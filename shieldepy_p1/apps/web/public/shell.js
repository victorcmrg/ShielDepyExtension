// Casca das telas logadas: menu lateral (empresa + papel, navegação, conta) igual em todas as
// páginas, pra o fluxo parecer um app só. A navegação depende do papel:
//   membro → Projetos, Minha conta
//   dono   → + Equipe
//   admin da plataforma → + Plataforma
// Páginas com <body data-require-owner> mandam quem não é dono de volta pros projetos.
(function () {
  const { el, icon } = window.sd;
  const ROLE_LABEL = { owner: 'Dono da empresa', member: 'Membro' };

  function navItem(href, label, iconName, active) {
    const a = el('a', 'side-link' + (active ? ' active' : ''));
    a.href = href;
    if (active) a.setAttribute('aria-current', 'page');
    a.append(icon(iconName), el('span', '', label));
    return a;
  }

  function render(me) {
    const page = document.body.dataset.page || '';
    const aside = document.getElementById('sidebar');
    if (!aside) return;
    aside.replaceChildren();

    const brand = el('a', 'side-brand');
    brand.href = '/projects.html';
    const logo = el('img');
    logo.src = '/logo-mark.svg';
    logo.alt = '';
    brand.append(logo, el('span', '', 'ShielDepy'));

    const company = el('div', 'side-company');
    company.append(el('span', 'side-company-avatar', (me.companyName || '?').charAt(0).toUpperCase()));
    const companyText = el('div', 'side-company-text');
    companyText.append(el('strong', '', me.companyName || 'Sem empresa'), el('span', '', ROLE_LABEL[me.role] || 'Membro'));
    company.appendChild(companyText);

    const nav = el('nav', 'side-nav');
    nav.setAttribute('aria-label', 'Navegação principal');
    nav.appendChild(navItem('/projects.html', 'Projetos', 'grid', page === 'projects' || page === 'project'));
    if (me.role === 'owner') nav.appendChild(navItem('/team.html', 'Equipe', 'users', page === 'team'));
    nav.appendChild(navItem('/account.html', 'Minha conta', 'user', page === 'account'));
    if (me.isAdmin) nav.appendChild(navItem('/admin.html', 'Plataforma', 'globe', page === 'platform'));

    const secondary = el('nav', 'side-nav side-nav-secondary');
    secondary.setAttribute('aria-label', 'Outros');
    secondary.appendChild(navItem('/app.html', 'Analisar no navegador', 'code', page === 'tool'));

    const status = el('p', 'side-status' + (me.permissions && me.permissions.accessEnabled === false ? ' off' : ''));
    status.append(el('span', 'side-status-dot'), el('span', '', me.permissions && me.permissions.accessEnabled === false ? 'Acesso da empresa suspenso' : 'Acesso liberado'));

    const foot = el('div', 'side-foot');
    const who = el('div', 'side-user');
    who.append(el('span', 'side-user-avatar', me.email.charAt(0).toUpperCase()), el('span', 'side-user-email', me.email));
    who.title = me.email;
    const actions = el('div', 'side-foot-actions');
    const theme = el('button', 'theme-toggle');
    theme.id = 'themeToggle';
    theme.type = 'button';
    const logout = el('button', 'side-logout');
    logout.type = 'button';
    logout.append(icon('logout'), el('span', '', 'Sair'));
    logout.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.href = '/login.html';
    });
    actions.append(theme, logout);
    foot.append(who, actions);

    aside.append(brand, company, nav, secondary, el('div', 'side-spacer'), status, foot);
    window.shieldepyTheme.mount();

    // Celular: o menu vira gaveta aberta pelo botão da barra do topo.
    const toggle = document.getElementById('menuToggle');
    if (toggle && !toggle.dataset.bound) {
      toggle.dataset.bound = '1';
      toggle.replaceChildren(icon('menu'));
      toggle.addEventListener('click', () => document.body.classList.toggle('side-open'));
      document.getElementById('sideScrim')?.addEventListener('click', () => document.body.classList.remove('side-open'));
    }
  }

  // O gate pode devolver null por "acesso suspenso" (a página mostra o bloqueio) — o menu aparece
  // mesmo assim; só não aparece sem sessão (aí o gate já está mandando pro login).
  window.shieldepyShell = window.shieldepyAuthReady.then(async (gated) => {
    const me = gated || (await window.shieldepyAuth.fetchMe());
    if (!me) return null;
    if (!gated) {
      render(me);
      return null;
    }
    if (document.body.hasAttribute('data-require-owner') && me.role !== 'owner') {
      window.location.href = '/projects.html';
      return null;
    }
    render(me);
    return me;
  });
})();
