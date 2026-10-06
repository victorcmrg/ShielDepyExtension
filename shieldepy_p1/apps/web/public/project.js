// Página de um projeto: repositórios (com o uso que a extensão registra a partir do .git),
// pessoas e o passo a passo. O dono edita tudo; o membro só consulta.
(function () {
  const { api, el, icon, modal, run, countUp, relativeTime, stagger, formatDate } = window.sd;
  const id = Number(new URLSearchParams(location.search).get('id'));
  const LIVE_MS = 15 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  let data = null;

  const short = (email) => email.split('@')[0];

  /** Linha de status do repositório, a partir do último uso registrado pela extensão. */
  function repoStatus(repo) {
    const meta = el('span', 'row-meta');
    const seen = repo.lastSeen;
    const age = seen ? Date.now() - seen.at : Infinity;
    const dot = el('span', 'live-dot ' + (age < LIVE_MS ? 'live' : age < DAY_MS ? 'recent' : 'idle'));
    let text;
    if (!seen) text = 'Ainda não foi aberto com a extensão';
    else {
      const who = short(seen.email) + (seen.branch ? ' na ' + seen.branch : '');
      text = age < LIVE_MS ? 'Em uso agora por ' + who : 'Usado ' + relativeTime(seen.at) + ' por ' + who;
      if (repo.usersLast24h > 1) text += ' (' + repo.usersLast24h + ' pessoas hoje)';
    }
    meta.append(dot, el('span', '', text));
    return meta;
  }

  function removeRow(li, action) {
    return async () => {
      const ok = await run(action);
      if (!ok) return;
      li.classList.add('leaving');
      setTimeout(load, 260);
    };
  }

  function renderRepos() {
    const list = document.getElementById('repos');
    list.replaceChildren();
    if (data.repos.length === 0) {
      const empty = el('li', 'empty-state compact');
      empty.appendChild(icon('branch'));
      empty.append(
        el('strong', '', 'Nenhum repositório conectado'),
        el('p', '', data.canManage ? 'Conecte o primeiro: cole o remote do .git (git remote get-url origin).' : 'O dono da empresa ainda não conectou os repositórios deste projeto.')
      );
      list.appendChild(empty);
      return;
    }
    const rows = data.repos.map((repo) => {
      const li = el('li', 'row-item');
      const ic = el('span', 'row-icon');
      ic.appendChild(icon('repo'));
      const main = el('div', 'row-main');
      const title = el('span', 'row-title mono', repo.label);
      title.title = repo.remote;
      main.append(title, repoStatus(repo));
      li.append(ic, main);
      if (data.canManage) {
        const del = el('button', 'icon-btn danger');
        del.type = 'button';
        del.setAttribute('aria-label', 'Desconectar ' + repo.label);
        del.title = 'Desconectar';
        del.appendChild(icon('trash'));
        del.addEventListener('click', async () => {
          const ok = await modal({
            title: 'Desconectar ' + repo.label + '?',
            body: 'A extensão deixa de funcionar nesse repositório para todos deste projeto.',
            confirmLabel: 'Desconectar',
            danger: true,
          });
          if (ok) await removeRow(li, () => api('/api/projects/' + id + '/repos/' + repo.id, { method: 'DELETE' }))();
        });
        li.appendChild(del);
      }
      list.appendChild(li);
      return li;
    });
    stagger(rows);
  }

  function renderPeople() {
    const list = document.getElementById('people');
    list.replaceChildren();
    document.getElementById('peopleNote').textContent = data.canManage
      ? 'Quem está aqui pode usar a extensão nos repositórios deste projeto. Você, como dono, já tem acesso a todos.'
      : 'Quem trabalha neste projeto com você.';
    if (data.members.length === 0) {
      const empty = el('li', 'empty-state compact');
      empty.appendChild(icon('users'));
      empty.append(el('strong', '', 'Ninguém além do dono'), el('p', '', data.canManage ? 'Adicione as pessoas que vão trabalhar aqui.' : ''));
      list.appendChild(empty);
      return;
    }
    const rows = data.members.map((m) => {
      const li = el('li', 'row-item');
      const avatar = el('span', 'person-avatar' + (m.status === 'active' ? ' active' : ''), m.email.charAt(0).toUpperCase());
      const main = el('div', 'row-main');
      main.append(
        el('span', 'row-title', m.email),
        el('span', 'row-meta', m.status === 'pending' ? 'Convite pendente: ainda não entrou' : m.lastLoginAt ? 'Entrou ' + relativeTime(m.lastLoginAt) : 'No projeto desde ' + formatDate(m.addedAt))
      );
      li.append(avatar, main);
      if (data.canManage) {
        const del = el('button', 'icon-btn danger');
        del.type = 'button';
        del.setAttribute('aria-label', 'Tirar ' + m.email + ' do projeto');
        del.title = 'Tirar do projeto';
        del.appendChild(icon('x'));
        del.addEventListener(
          'click',
          removeRow(li, () => api('/api/projects/' + id + '/members/' + encodeURIComponent(m.email), { method: 'DELETE' }))
        );
        li.appendChild(del);
      }
      list.appendChild(li);
      return li;
    });
    stagger(rows);
  }

  function render() {
    const p = data.project;
    document.title = p.name + ' — ShielDepy';
    document.getElementById('topTitle').textContent = p.name;
    document.getElementById('tile').textContent = p.name.charAt(0).toUpperCase();
    document.getElementById('name').textContent = p.name;
    document.getElementById('description').textContent = p.description || (data.canManage ? 'Sem descrição.' : '');
    document.getElementById('crumbName').textContent = p.name;
    document.getElementById('headActions').hidden = !data.canManage;
    document.getElementById('addRepo').hidden = !data.canManage;
    document.getElementById('addPerson').hidden = !data.canManage;
    countUp(document.getElementById('mRepos'), data.repos.length);
    countUp(document.getElementById('mPeople'), data.members.length);
    countUp(document.getElementById('mLive'), data.repos.filter((r) => r.lastSeen && Date.now() - r.lastSeen.at < DAY_MS).length);
    renderRepos();
    renderPeople();
  }

  async function load() {
    data = await api('/api/projects/' + id);
    render();
  }

  document.getElementById('crumbSep').appendChild(icon('chevron'));

  document.getElementById('addRepo').addEventListener('click', async () => {
    const values = await modal({
      title: 'Conectar repositório',
      body: 'Quem estiver neste projeto passa a usar a extensão nesse repositório.',
      confirmLabel: 'Conectar',
      fields: [
        {
          name: 'url',
          label: 'Remote do repositório',
          placeholder: 'https://github.com/empresa/repositorio.git',
          required: true,
          hint: 'No terminal, dentro do repositório: git remote get-url origin. Serve https ou ssh.',
        },
      ],
    });
    if (values && (await run(() => api('/api/projects/' + id + '/repos', { method: 'POST', body: values }), 'Repositório conectado'))) load();
  });

  document.getElementById('addPerson').addEventListener('click', async () => {
    if (data.candidates.length === 0) {
      const go = await modal({
        title: 'Todos da equipe já estão aqui',
        body: 'Para trazer alguém novo, convide a pessoa em Equipe e depois adicione ao projeto.',
        confirmLabel: 'Ir para Equipe',
      });
      if (go) location.href = '/team.html';
      return;
    }
    const values = await modal({
      title: 'Adicionar ao projeto',
      confirmLabel: 'Adicionar',
      fields: [{ name: 'emails', label: 'Pessoas da equipe', type: 'checkboxes', options: data.candidates.map((e) => ({ value: e, label: e })) }],
    });
    if (!values || values.emails.length === 0) return;
    const ok = await run(async () => {
      for (const email of values.emails) await api('/api/projects/' + id + '/members', { method: 'POST', body: { email } });
    }, values.emails.length === 1 ? 'Pessoa adicionada' : 'Pessoas adicionadas');
    if (ok) load();
  });

  document.getElementById('editBtn').addEventListener('click', async () => {
    const values = await modal({
      title: 'Editar projeto',
      confirmLabel: 'Salvar',
      fields: [
        { name: 'name', label: 'Nome', value: data.project.name, required: true },
        { name: 'description', label: 'Descrição', value: data.project.description },
      ],
    });
    if (values && (await run(() => api('/api/projects/' + id, { method: 'PATCH', body: values }), 'Projeto atualizado'))) load();
  });

  document.getElementById('deleteBtn').addEventListener('click', async () => {
    const ok = await modal({
      title: 'Excluir ' + data.project.name + '?',
      body: 'Os repositórios deixam de estar liberados e as pessoas saem do projeto. Isso não mexe no código.',
      confirmLabel: 'Excluir projeto',
      danger: true,
    });
    if (ok && (await run(() => api('/api/projects/' + id, { method: 'DELETE' }), 'Projeto excluído'))) location.href = '/projects.html';
  });

  window.shieldepyShell.then(async (me) => {
    if (!me) return;
    try {
      await load();
    } catch {
      location.href = '/projects.html';
    }
  });
})();
