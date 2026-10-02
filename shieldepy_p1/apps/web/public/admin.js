(async function () {
  const { api, el, icon, run, modal, countUp, relativeTime, formatDate, switchControl, stagger } = window.sd;
  const me = await window.shieldepyAuthReady;
  if (!me) return;

  const companiesEl = document.getElementById('companies');
  const statsEl = document.getElementById('stats');
  const search = document.getElementById('search');
  const expanded = new Set();
  const membersCache = new Map();
  let companies = [];

  const newBtn = document.getElementById('newCompanyBtn');
  newBtn.append(icon('plus'), el('span', '', 'Nova empresa'));
  document.getElementById('searchIcon').replaceWith(icon('search'));

  // ---------- estatísticas ----------
  const STAT_DEFS = [
    { key: 'companies', label: 'Empresas', icon: 'building', sub: (o) => (o.suspendedCompanies ? o.suspendedCompanies + ' suspensa(s)' : 'todas ativas') },
    { key: 'users', label: 'Usuários ativos', icon: 'users', sub: () => 'já entraram ao menos uma vez' },
    { key: 'pendingInvites', label: 'Convites pendentes', icon: 'mail', sub: () => 'e-mails liberados sem login' },
    { key: 'activeDevices', label: 'VS Codes conectados', icon: 'device', sub: () => 'tokens de dispositivo válidos' },
    { key: 'aiCompanies', label: 'Empresas com IA', icon: 'spark', sub: (o) => 'de ' + o.companies + ' no total' },
  ];

  async function loadStats() {
    const overview = await api('/api/admin/overview');
    if (statsEl.querySelector('.skeleton')) {
      statsEl.replaceChildren();
      const cards = STAT_DEFS.map((def) => {
        const card = el('div', 'stat-card');
        card.dataset.key = def.key;
        const top = el('div', 'stat-top');
        top.append(icon(def.icon), el('span', 'stat-label', def.label));
        card.append(top, el('div', 'stat-value', '0'), el('div', 'stat-sub'));
        statsEl.appendChild(card);
        return card;
      });
      stagger(cards);
    }
    for (const def of STAT_DEFS) {
      const card = statsEl.querySelector('[data-key="' + def.key + '"]');
      countUp(card.querySelector('.stat-value'), overview[def.key]);
      card.querySelector('.stat-sub').textContent = def.sub(overview);
    }
  }

  // ---------- empresas ----------
  async function loadCompanies() {
    companies = await api('/api/admin/companies');
    await Promise.all([...expanded].map((id) => loadMembers(id)));
    renderCompanies();
  }

  async function loadMembers(companyId) {
    membersCache.set(companyId, await api('/api/admin/companies/' + companyId + '/members'));
  }

  async function refresh() {
    await Promise.all([loadStats(), loadCompanies()]);
  }

  function matchesSearch(company) {
    const q = search.value.trim().toLowerCase();
    if (!q) return true;
    if (company.name.toLowerCase().includes(q)) return true;
    return (membersCache.get(company.id) || []).some((m) => m.email.includes(q));
  }

  function badge(text, kind) {
    return el('span', 'badge badge-' + kind, text);
  }

  function renderCompanies() {
    const visible = companies.filter(matchesSearch);
    companiesEl.replaceChildren();
    if (companies.length === 0) {
      companiesEl.appendChild(emptyState('Nenhuma empresa ainda', 'Crie a primeira empresa pra começar a liberar acessos.'));
      return;
    }
    if (visible.length === 0) {
      companiesEl.appendChild(emptyState('Nada encontrado', 'Nenhuma empresa ou e-mail bate com "' + search.value.trim() + '".'));
      return;
    }
    const rows = visible.map(renderCompany);
    rows.forEach((r) => companiesEl.appendChild(r));
    stagger(rows);
  }

  function emptyState(title, text) {
    const box = el('div', 'empty-state');
    box.append(icon('building'), el('strong', '', title), el('p', '', text));
    return box;
  }

  function renderCompany(company) {
    const suspended = company.permissions.accessEnabled === false;
    const row = el('article', 'company-row' + (suspended ? ' is-suspended' : '') + (expanded.has(company.id) ? ' open' : ''));

    const head = el('div', 'company-head');
    const avatar = el('div', 'company-avatar', company.name.trim().charAt(0).toUpperCase() || '?');
    const info = el('div', 'company-info');
    const titleLine = el('div', 'company-title');
    titleLine.append(el('h3', '', company.name));
    titleLine.append(suspended ? badge('Suspensa', 'danger') : badge('Ativa', 'ok'));
    if (company.permissions.aiEnabled) titleLine.append(badge('IA', 'brand'));
    const meta = el(
      'p',
      'company-meta',
      company.memberCount + ' membro(s) · ' + company.pendingCount + ' convite(s) pendente(s) · criada em ' + formatDate(company.createdAt)
    );
    info.append(titleLine, meta);

    const controls = el('div', 'company-controls');
    controls.append(
      switchControl('Acesso liberado', !suspended, (value) =>
        run(async () => {
          await api('/api/admin/companies/' + company.id + '/permissions', { method: 'PATCH', body: { key: 'accessEnabled', value } });
          await refresh();
        }, value ? 'Acesso de ' + company.name + ' liberado' : company.name + ' suspensa — as extensões perdem acesso em até 1 min')
      ),
      switchControl('Bot de IA', Boolean(company.permissions.aiEnabled), (value) =>
        run(async () => {
          await api('/api/admin/companies/' + company.id + '/permissions', { method: 'PATCH', body: { key: 'aiEnabled', value } });
          await refresh();
        }, value ? 'IA liberada para ' + company.name : 'IA desligada para ' + company.name)
      )
    );

    const actions = el('div', 'company-actions');
    const rename = iconButton('edit', 'Renomear', async () => {
      const values = await modal({ title: 'Renomear empresa', fields: [{ name: 'name', label: 'Nome', value: company.name, required: true }], confirmLabel: 'Salvar' });
      if (!values || !values.name.trim() || values.name.trim() === company.name) return;
      await run(async () => {
        await api('/api/admin/companies/' + company.id, { method: 'PATCH', body: { name: values.name.trim() } });
        await refresh();
      }, 'Empresa renomeada');
    });
    const remove = iconButton('trash', 'Excluir empresa', async () => {
      const ok = await modal({
        title: 'Excluir "' + company.name + '"?',
        body: 'Todos os usuários, convites e VS Codes conectados desta empresa são removidos. Não dá pra desfazer.',
        confirmLabel: 'Excluir empresa',
        danger: true,
      });
      if (!ok) return;
      await run(async () => {
        await api('/api/admin/companies/' + company.id, { method: 'DELETE' });
        expanded.delete(company.id);
        await refresh();
      }, 'Empresa excluída');
    });
    remove.classList.add('danger');

    // O conteúdo mora num wrapper interno: a animação de altura (grid 0fr → 1fr) precisa disso.
    const body = el('div', 'company-body');
    const bodyInner = el('div', 'company-body-inner');
    if (membersCache.has(company.id)) bodyInner.appendChild(renderMembers(company));
    body.appendChild(bodyInner);

    const toggle = el('button', 'expand-btn');
    toggle.type = 'button';
    toggle.append(el('span', '', 'Membros'), icon('chevron'));
    toggle.addEventListener('click', async () => {
      if (expanded.has(company.id)) {
        expanded.delete(company.id);
        row.classList.remove('open');
        return;
      }
      expanded.add(company.id);
      if (!membersCache.has(company.id)) await run(() => loadMembers(company.id));
      bodyInner.replaceChildren(renderMembers(company));
      row.classList.add('open');
    });
    actions.append(rename, remove, toggle);

    head.append(avatar, info, controls, actions);
    row.append(head, body);
    return row;
  }

  function iconButton(iconName, label, onClick) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(icon(iconName));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderMembers(company) {
    const wrap = el('div', 'members');
    const members = membersCache.get(company.id) || [];
    if (members.length === 0) {
      wrap.appendChild(el('p', 'members-empty', 'Nenhum e-mail liberado ainda — adicione o primeiro abaixo.'));
    } else {
      const list = el('ul', 'member-list');
      for (const m of members) list.appendChild(renderMember(company, m));
      wrap.appendChild(list);
    }

    const form = el('form', 'add-member');
    const email = el('input');
    email.type = 'email';
    email.placeholder = 'pessoa@empresa.com';
    email.required = true;
    const password = el('input');
    password.type = 'password';
    password.placeholder = 'senha inicial (opcional — mín. 8)';
    password.autocomplete = 'new-password';
    const submit = el('button', 'btn-brand small');
    submit.type = 'submit';
    submit.append(icon('plus'), el('span', '', 'Liberar e-mail'));
    form.append(email, password, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        await run(async () => {
          await api('/api/admin/companies/' + company.id + '/emails', { method: 'POST', body: { email: email.value, initialPassword: password.value || undefined } });
          await refresh();
        }, email.value.trim() + ' liberado em ' + company.name);
      } finally {
        submit.disabled = false;
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  function renderMember(company, m) {
    const li = el('li', 'member ' + m.status);
    const who = el('div', 'member-who');
    who.append(el('span', 'member-dot'), el('span', 'member-email', m.email));
    const detail = el(
      'span',
      'member-detail',
      m.status === 'pending' ? 'convite pendente — ainda não entrou' : 'último login ' + relativeTime(m.lastLoginAt) + ' · ' + m.activeDevices + ' VS Code(s)'
    );
    const actions = el('div', 'member-actions');

    if (m.status === 'pending') {
      actions.appendChild(
        textButton('Cancelar convite', async () => {
          await run(async () => {
            await api('/api/admin/emails/' + encodeURIComponent(m.email), { method: 'DELETE' });
            await refresh();
          }, 'Convite de ' + m.email + ' cancelado');
        })
      );
    } else {
      if (m.activeDevices > 0) {
        actions.appendChild(
          textButton('Desconectar VS Codes', async () => {
            await run(async () => {
              await api('/api/admin/users/' + m.id + '/revoke-devices', { method: 'POST' });
              await refresh();
            }, 'Dispositivos de ' + m.email + ' desconectados');
          })
        );
      }
      if (m.email !== me.email) {
        const b = textButton('Remover', async () => {
          const ok = await modal({
            title: 'Remover ' + m.email + '?',
            body: 'A conta é apagada e o e-mail sai da lista de liberados de ' + company.name + '.',
            confirmLabel: 'Remover',
            danger: true,
          });
          if (!ok) return;
          await run(async () => {
            await api('/api/admin/users/' + m.id, { method: 'DELETE' });
            await refresh();
          }, m.email + ' removido');
        });
        b.classList.add('danger');
        actions.appendChild(b);
      }
    }
    li.append(who, detail, actions);
    return li;
  }

  function textButton(label, onClick) {
    const b = el('button', 'text-btn', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  newBtn.addEventListener('click', async () => {
    const values = await modal({
      title: 'Nova empresa',
      body: 'Ela já nasce com acesso liberado e a IA desligada — dá pra mudar depois.',
      fields: [{ name: 'name', label: 'Nome da empresa', placeholder: 'Ex.: Acme Ltda', required: true }],
      confirmLabel: 'Criar empresa',
    });
    if (!values || !values.name.trim()) return;
    await run(async () => {
      const company = await api('/api/admin/companies', { method: 'POST', body: { name: values.name.trim() } });
      expanded.add(company.id);
      await refresh();
    }, 'Empresa criada — libere os e-mails dela abaixo');
  });

  search.addEventListener('input', renderCompanies);

  await run(refresh);
})();
