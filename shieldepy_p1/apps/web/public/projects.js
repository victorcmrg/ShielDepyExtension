// Projetos: a tela inicial de todo mundo depois do login.
//   dono   → todos os projetos da empresa, "Novo projeto" e os primeiros passos até a equipe usar
//   membro → só os projetos em que trabalha (é neles que a extensão funciona)
(function () {
  const { api, el, icon, modal, run, stagger, relativeTime } = window.sd;
  const grid = document.getElementById('grid');
  const search = document.getElementById('search');
  const filterEl = document.getElementById('filter');
  let data = null;
  let filter = 'all';

  document.querySelector('.search-box').prepend(icon('search'));

  const isLive = (p) => p.activeRepos > 0;

  function statusBadge(p) {
    if (isLive(p)) return el('span', 'badge badge-live', 'Em uso');
    if (p.repoCount > 0) return el('span', 'badge badge-muted', 'Pronto');
    return el('span', 'badge badge-warn', 'Sem repositório');
  }

  function card(p) {
    const a = el('a', 'project-card');
    a.href = '/project.html?id=' + p.id;

    const head = el('div', 'pc-head');
    const title = el('div', 'pc-title');
    title.append(el('h3', '', p.name), el('p', '', p.description || 'Sem descrição'));
    head.append(el('span', 'project-tile', p.name.charAt(0).toUpperCase()), title);

    const repo = el('div', 'pc-repo');
    repo.appendChild(icon('branch'));
    repo.appendChild(
      el('span', '', p.repoCount === 0 ? 'Nenhum repositório conectado' : p.repoCount === 1 ? '1 repositório' : p.repoCount + ' repositórios')
    );
    if (p.lastActivityAt) repo.appendChild(el('em', '', 'usado ' + relativeTime(p.lastActivityAt)));

    const foot = el('div', 'pc-foot');
    const people = el('div', 'pc-people');
    const stack = el('div', 'avatar-stack');
    for (const email of p.memberPreview) {
      const s = el('span', '', email.charAt(0).toUpperCase());
      s.title = email;
      stack.appendChild(s);
    }
    people.append(stack, el('span', '', p.memberCount === 0 ? 'Só o dono' : p.memberCount === 1 ? '1 pessoa' : p.memberCount + ' pessoas'));
    foot.append(people, statusBadge(p));

    a.append(head, repo, foot);
    return a;
  }

  /** Dono: três passos até a equipe estar usando. Some quando tudo estiver feito. */
  function renderSetup() {
    const box = document.getElementById('setup');
    if (data.me.role !== 'owner') return;
    const ps = data.projects;
    const steps = [
      { done: ps.length > 0, title: 'Crie um projeto', text: 'Um projeto agrupa os repositórios de um produto e as pessoas que trabalham nele.', action: 'Novo projeto', go: createProject },
      {
        done: ps.some((p) => p.repoCount > 0),
        title: 'Conecte os repositórios',
        text: 'Cole o remote do .git. A extensão só funciona nos repositórios conectados.',
        action: 'Abrir projeto',
        go: () => ps[0] && (location.href = '/project.html?id=' + ps[0].id),
      },
      {
        done: ps.some((p) => p.memberCount > 0),
        title: 'Adicione a equipe',
        text: 'Escolha quem pode usar a ferramenta em cada projeto.',
        action: 'Ir para a equipe',
        go: () => (location.href = '/team.html'),
      },
    ];
    if (steps.every((s) => s.done)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.replaceChildren();
    const current = steps.findIndex((s) => !s.done);
    steps.forEach((s, i) => {
      const step = el('div', 'setup-step' + (s.done ? ' done' : i === current ? ' current' : ''));
      const n = el('span', 'step-n');
      if (s.done) n.appendChild(icon('check'));
      else n.textContent = String(i + 1);
      const text = el('div');
      text.append(el('strong', '', s.title), el('p', '', s.text));
      if (i === current) {
        const btn = el('button', 'text-btn', s.action);
        btn.type = 'button';
        btn.addEventListener('click', s.go);
        text.appendChild(btn);
      }
      step.append(n, text);
      box.appendChild(step);
    });
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = data.projects.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)) &&
        (filter === 'all' || (filter === 'live' ? isLive(p) : p.repoCount === 0))
    );
    grid.replaceChildren();
    if (list.length === 0) {
      grid.appendChild(emptyState(q || filter !== 'all'));
    } else {
      const cards = list.map(card);
      cards.forEach((c) => grid.appendChild(c));
      stagger(cards);
    }
    const total = data.projects.length;
    const live = data.projects.filter(isLive).length;
    document.getElementById('foot').textContent =
      total === 0 ? '' : `Total de ${total} ${total === 1 ? 'projeto' : 'projetos'}, ${live} em uso nas últimas 24 horas.`;
  }

  function emptyState(filtered) {
    const box = el('div', 'empty-state');
    box.style.setProperty('grid-column', '1 / -1');
    box.appendChild(icon('folder'));
    if (filtered) {
      box.append(el('strong', '', 'Nenhum projeto com esse filtro'), el('p', '', 'Limpe a busca ou escolha "Todos".'));
    } else if (data.me.role === 'owner') {
      box.append(el('strong', '', 'Nenhum projeto ainda'), el('p', '', 'Crie o primeiro projeto e conecte os repositórios da equipe.'));
      const btn = el('button', 'btn-brand small', 'Novo projeto');
      btn.type = 'button';
      btn.style.setProperty('margin-top', '10px');
      btn.addEventListener('click', createProject);
      box.appendChild(btn);
    } else {
      box.append(
        el('strong', '', 'Você ainda não está em nenhum projeto'),
        el('p', '', 'Peça ao dono da empresa para te adicionar. Assim que ele fizer isso, o projeto aparece aqui.')
      );
    }
    return box;
  }

  async function createProject() {
    const values = await modal({
      title: 'Novo projeto',
      body: 'Depois de criar, conecte os repositórios e escolha quem trabalha nele.',
      confirmLabel: 'Criar projeto',
      fields: [
        { name: 'name', label: 'Nome', placeholder: 'Ex.: Pedidos', required: true },
        { name: 'description', label: 'Descrição (opcional)', placeholder: 'Ex.: Microserviços de pedidos e preço' },
      ],
    });
    if (!values) return;
    let created = null;
    const ok = await run(async () => {
      created = await api('/api/projects', { method: 'POST', body: values });
    }, 'Projeto criado');
    if (ok && created) location.href = '/project.html?id=' + created.id;
  }

  filterEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    filterEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
  search.addEventListener('input', render);
  document.getElementById('newProject').addEventListener('click', createProject);

  window.shieldepyShell.then(async (me) => {
    if (!me) return;
    data = await api('/api/workspace');
    const owner = data.me.role === 'owner';
    document.getElementById('newProject').hidden = !owner;
    document.getElementById('pageSub').textContent = owner
      ? 'Os projetos da empresa. Em cada um você conecta os repositórios e escolhe quem pode usar a ferramenta neles.'
      : 'Os projetos em que você trabalha. A extensão funciona nos repositórios deles.';
    if (!data.me.accessEnabled) {
      const bar = el('div', 'notice-bar');
      bar.append(icon('lock'), el('span', '', 'O acesso da empresa está suspenso. A extensão fica pausada até o administrador liberar.'));
      document.getElementById('notice').appendChild(bar);
    }
    renderSetup();
    render();
  });
})();
