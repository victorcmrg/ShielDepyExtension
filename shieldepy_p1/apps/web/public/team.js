// Equipe (só o dono): convidar já escolhendo os projetos, trocar papel e tirar da empresa.
(function () {
  const { api, el, icon, modal, run, relativeTime, stagger } = window.sd;
  const rows = document.getElementById('rows');
  const search = document.getElementById('search');
  let data = null;

  document.querySelector('.search-box').prepend(icon('search'));

  function row(m) {
    const li = el('li', 'team-row');
    const isMe = m.email.toLowerCase() === data.me.toLowerCase();

    const who = el('div', 'team-who');
    const text = el('div', 'row-main');
    text.append(
      el('span', 'row-title', m.email + (isMe ? ' (você)' : '')),
      el('span', 'row-meta', m.status === 'pending' ? 'Convite pendente: ainda não entrou' : m.lastLoginAt ? 'Entrou ' + relativeTime(m.lastLoginAt) : 'Ativo')
    );
    who.append(el('span', 'person-avatar' + (m.status === 'active' ? ' active' : ''), m.email.charAt(0).toUpperCase()), text);

    // Papel: select simples — dono administra projetos/equipe, membro usa.
    const role = el('select', 'role-select');
    role.setAttribute('aria-label', 'Papel de ' + m.email);
    for (const [value, label] of [['member', 'Membro'], ['owner', 'Dono']]) {
      const o = el('option', '', label);
      o.value = value;
      role.appendChild(o);
    }
    role.value = m.role;
    role.addEventListener('change', async () => {
      const next = role.value;
      const ok = await run(
        () => api('/api/team/' + encodeURIComponent(m.email), { method: 'PATCH', body: { role: next } }),
        next === 'owner' ? m.email + ' agora é dono' : m.email + ' agora é membro'
      );
      if (!ok) role.value = m.role;
      else m.role = next;
    });

    const chips = el('div', 'chips');
    if (m.role === 'owner') chips.appendChild(el('span', 'chip', 'Todos os projetos'));
    else if (m.projects.length === 0) chips.appendChild(el('span', 'chip empty', 'Nenhum projeto'));
    else for (const name of m.projects) chips.appendChild(el('span', 'chip', name));

    const actions = el('div', 'member-actions');
    if (!isMe) {
      const del = el('button', 'icon-btn danger');
      del.type = 'button';
      del.title = 'Tirar da empresa';
      del.setAttribute('aria-label', 'Tirar ' + m.email + ' da empresa');
      del.appendChild(icon('trash'));
      del.addEventListener('click', async () => {
        const ok = await modal({
          title: 'Tirar ' + m.email + ' da empresa?',
          body: 'A pessoa sai de todos os projetos e os VS Codes dela são desconectados.',
          confirmLabel: 'Tirar da empresa',
          danger: true,
        });
        if (!ok) return;
        if (await run(() => api('/api/team/' + encodeURIComponent(m.email), { method: 'DELETE' }), 'Pessoa removida')) {
          li.classList.add('leaving');
          setTimeout(load, 260);
        }
      });
      actions.appendChild(del);
    }

    li.append(who, role, chips, actions);
    return li;
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = data.members.filter((m) => !q || m.email.toLowerCase().includes(q));
    rows.replaceChildren();
    const items = list.map(row);
    items.forEach((i) => rows.appendChild(i));
    stagger(items);
    const pending = data.members.filter((m) => m.status === 'pending').length;
    document.getElementById('foot').textContent =
      `Total de ${data.members.length} ${data.members.length === 1 ? 'pessoa' : 'pessoas'}` + (pending ? `, ${pending} com convite pendente.` : '.');
  }

  async function load() {
    data = await api('/api/team');
    render();
  }

  document.getElementById('invite').addEventListener('click', async () => {
    const values = await modal({
      title: 'Convidar pessoa',
      body: 'A pessoa entra com este e-mail e a senha inicial, e já cai nos projetos que você marcar.',
      confirmLabel: 'Convidar',
      fields: [
        { name: 'email', label: 'E-mail', type: 'email', placeholder: 'nome@empresa.com', required: true, autocomplete: 'off' },
        { name: 'initialPassword', label: 'Senha inicial', type: 'password', placeholder: 'Pelo menos 8 caracteres', autocomplete: 'new-password', hint: 'Envie para a pessoa por um canal seguro. Ela pode trocar em Minha conta.' },
        { name: 'role', label: 'Papel', type: 'select', options: [{ value: 'member', label: 'Membro: usa a ferramenta nos projetos dele' }, { value: 'owner', label: 'Dono: administra projetos e equipe' }] },
        { name: 'projectIds', label: 'Projetos', type: 'checkboxes', options: data.projects.map((p) => ({ value: p.id, label: p.name })), emptyText: 'Nenhum projeto criado ainda.' },
      ],
    });
    if (!values) return;
    const body = { ...values, projectIds: values.projectIds.map(Number) };
    if (await run(() => api('/api/team', { method: 'POST', body }), 'Convite criado para ' + values.email)) load();
  });

  search.addEventListener('input', render);
  window.shieldepyShell.then((me) => me && load());
})();
