// Painel "Guardião de Arquitetura". Todo texto vindo da extensão entra via textContent — nunca innerHTML.
(function () {
  const vscode = acquireVsCodeApi();
  const initial = window.__INITIAL__ || {};
  const $ = (id) => document.getElementById(id);
  const findingsEl = $('findings');
  const summaryEl = $('summary');
  const tilesEl = $('stats');
  // Textos no idioma escolhido nas configurações (vêm prontos da extensão).
  const STR = initial.t || {};
  const T = (key, vars) => (STR[key] || key).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  const SEVERITIES = { error: T('sevError'), warning: T('sevWarning'), info: T('sevInfo') };
  const COUNT_IDS = { error: 'countError', warning: 'countWarning', info: 'countInfo' };

  const openFiles = new Set(); // gavetas abertas sobrevivem aos re-renders
  const openBalloons = new Set(); // balões abertos idem
  const seenFindings = new Set(); // só achado NOVO ganha destaque
  let firstRender = true;
  let lastGroups = [];
  let lastSystemDisabled = false;
  let severityFilter = null;
  let loggedIn = false;
  let company = '';
  let projectName = '';
  const counts = { error: 0, warning: 0, info: 0 };

  $('graphNotice').hidden = initial.graphReady !== false;
  // Sem transições/animações até o primeiro estado chegar: abrir a aba não "pisca" nada.
  document.body.classList.add('preload');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Reinicia uma animação de classe (o navegador só anima de novo se a classe sair e voltar). */
  function replay(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }

  /** A forma da severidade (quadrado, triângulo, círculo) — o ícone de achados e arquivos. */
  function badge(severity, size) {
    const sev = SEVERITIES[severity] ? severity : 'info';
    const shape = el('span', 'shape ' + sev + (size ? ' ' + size : ''));
    shape.title = SEVERITIES[sev];
    return shape;
  }

  // --- aviso da IA da empresa (a análise local nunca trava; R1 do plano) ------------------
  const AI_BLOCKS = {
    suspended: {
      title: T('lockSuspendedTitle'),
      text: T('lockSuspendedText'),
      action: T('checkAgain'),
      message: 'refreshAccess',
      secondary: T('openDashboard'),
      secondaryMessage: 'openDashboard',
    },
    // Conta ok, mas o repositório aberto não está em nenhum projeto da pessoa (ou nem tem .git).
    repoBlocked: {
      title: T('lockRepoTitle'),
      text: T('lockRepoText'),
      action: T('checkAgain'),
      message: 'refreshAccess',
      secondary: T('openProjects'),
      secondaryMessage: 'openDashboard',
    },
    noGit: {
      title: T('lockNoGitTitle'),
      text: T('lockNoGitText'),
      action: T('checkAgain'),
      message: 'refreshAccess',
      secondary: T('openProjects'),
      secondaryMessage: 'openDashboard',
    },
    aiDisabled: {
      title: T('lockAiOffTitle'),
      text: T('lockAiOffText'),
      action: T('checkAgain'),
      message: 'refreshAccess',
      secondary: T('openDashboard'),
      secondaryMessage: 'openDashboard',
    },
  };

  function setAccess(msg) {
    loggedIn = Boolean(msg.loggedIn);
    company = msg.company || '';
    projectName = msg.project || '';
    renderHeader();
    const block = AI_BLOCKS[msg.block === 'repoBlocked' && !msg.remote ? 'noGit' : msg.block];
    $('aiNotice').hidden = !block;
    if (!block) return;
    $('aiNoticeTitle').textContent = block.title;
    $('aiNoticeText').textContent = ' ' + block.text.replace('{company}', company || T('yourCompany')).replace('{remote}', msg.remote || '');
    const action = $('aiNoticeAction');
    action.textContent = block.action;
    action.disabled = false;
    action.onclick = () => {
      action.disabled = true;
      vscode.postMessage({ type: block.message });
      setTimeout(() => (action.disabled = false), 2500);
    };
    const secondary = $('aiNoticeSecondary');
    secondary.textContent = block.secondary;
    secondary.onclick = () => vscode.postMessage({ type: block.secondaryMessage });
  }

  function renderHeader() {
    $('status').textContent = lastSystemDisabled ? T('guardPaused') : T('guardTitle');
    // Em nome de quê a extensão está ligada: empresa e projeto, ou o modo local (sem conta).
    $('statusSub').textContent = loggedIn ? [company, projectName && T('projectLabel', { name: projectName })].filter(Boolean).join(' / ') : T('localMode');
  }

  // --- ladrilhos: contagem + filtro -------------------------------------------------------
  function setCounts(next) {
    for (const sev of Object.keys(COUNT_IDS)) {
      const value = (next && next[sev]) || 0;
      const node = $(COUNT_IDS[sev]);
      if (value !== counts[sev]) {
        node.textContent = String(value);
        if (!firstRender) replay(node, 'changed');
      }
      counts[sev] = value;
    }
  }

  tilesEl.querySelectorAll('.tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const sev = tile.dataset.severity;
      severityFilter = severityFilter === sev ? null : sev;
      replay(tile, 'tapped');
      tilesEl.classList.toggle('filtering', Boolean(severityFilter));
      tilesEl.querySelectorAll('.tile').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.severity === severityFilter)));
      renderGroups(lastGroups, lastSystemDisabled);
    });
  });

  // --- balão de detalhes ------------------------------------------------------------------
  function codeBlock(snippet) {
    const code = el('pre', 'code');
    for (const line of snippet.lines) {
      const row = el('div', 'code-line' + (line.hit ? ' hit' : ''));
      row.append(el('span', 'ln', String(line.number)), el('span', '', line.text || ' '));
      code.appendChild(row);
    }
    return code;
  }

  function renderBalloon(item) {
    const wrap = el('div', 'balloon-wrap');
    const clip = el('div', 'balloon-clip');
    const balloon = el('div', 'balloon');
    balloon.setAttribute('role', 'region');
    balloon.setAttribute('aria-label', T('detailsOf', { ref: item.ref }));

    if (item.conflicts.length > 0) {
      // Colisão: o código de quem está do outro lado. O nome do arquivo abre ele.
      for (const c of item.conflicts) {
        const head = el('button', 'balloon-file');
        head.append(el('strong', '', c.fileName), ' ' + T('lineLower', { n: c.line + 1 }));
        if (c.folder) head.title = c.folder + '/' + c.fileName;
        head.addEventListener('click', () => vscode.postMessage({ type: 'openRelated', file: c.file, line: c.line }));
        balloon.append(head, codeBlock(c));
      }
    } else {
      if (item.snippet) balloon.appendChild(codeBlock(item.snippet));
      if (item.impact) balloon.appendChild(el('p', 'balloon-note', item.impact));
    }

    const actions = el('div', 'balloon-actions');
    const goTo = el('button', 'text-btn', T('goToLine', { n: item.line + 1 }));
    goTo.addEventListener('click', () => vscode.postMessage({ type: 'reveal', fileId: item.fileId, line: item.line }));
    // "Perguntar para IA" fecha o card, no canto direito (CSS: margin-left auto).
    const ask = el('button', 'text-btn ask', T('askAI'));
    ask.addEventListener('click', () =>
      vscode.postMessage({ type: 'askAI', finding: { id: item.id, ref: item.ref, fileId: item.fileId, fileName: item.fileName, line: item.line, message: item.message } })
    );
    actions.append(goTo, ask);
    balloon.appendChild(actions);

    clip.appendChild(balloon);
    wrap.appendChild(clip);
    return wrap;
  }

  // --- achados ---------------------------------------------------------------------------
  function renderFinding(item) {
    const finding = el('div', 'finding ' + (SEVERITIES[item.severity] ? item.severity : 'info'));
    const conflictNames = item.conflicts.map((c) => c.fileName).join(', ');
    if (!seenFindings.has(item.id) && !firstRender) finding.classList.add('new');
    seenFindings.add(item.id);

    // A linha inteira é o alvo do clique: passar o mouse já "espia" o balão, clicar abre.
    const row = el('button', 'finding-row');
    row.appendChild(badge(item.severity));
    const text = el('span', 'finding-text');
    text.appendChild(el('span', 'finding-message', item.message));
    const meta = el('span', 'finding-meta');
    meta.append(el('span', 'ref', '#' + item.ref), el('span', '', T('lineN', { n: item.line + 1 })));
    if (conflictNames) meta.appendChild(el('span', 'conflict', T('conflictWith', { files: conflictNames })));
    text.appendChild(meta);
    row.appendChild(text);

    row.addEventListener('click', () => {
      const open = finding.classList.toggle('balloon-open');
      row.setAttribute('aria-expanded', String(open));
      if (open) openBalloons.add(item.id);
      else openBalloons.delete(item.id);
    });

    const open = openBalloons.has(item.id);
    finding.classList.toggle('balloon-open', open);
    row.setAttribute('aria-expanded', String(open));
    finding.append(row, renderBalloon(item));
    return finding;
  }

  function renderGroups(groups, systemDisabled) {
    lastGroups = groups || [];
    lastSystemDisabled = systemDisabled;
    renderHeader();
    const previousCounts = new Map([...findingsEl.querySelectorAll('.file')].map((n) => [n.dataset.file, n.dataset.count]));
    findingsEl.replaceChildren();
    findingsEl.classList.remove('is-empty');

    if (systemDisabled) {
      findingsEl.classList.add('is-empty');
      const empty = el('div', 'empty', T('analysisOff') + ' ');
      const link = el('button', 'text-btn', T('turnOn'));
      link.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
      empty.appendChild(link);
      findingsEl.appendChild(empty);
      return;
    }
    const visible = lastGroups
      .map((g) => ({ ...g, items: severityFilter ? g.items.filter((i) => i.severity === severityFilter) : g.items }))
      .filter((g) => g.items.length > 0);
    if (visible.length === 0) {
      // Uma área vazia só, com uma frase no meio — o resumo fica no fim dela. Sem filtro, a
      // lista vazia vira o ponto de partida: o mapa, o caos e os primeiros passos.
      findingsEl.classList.add('is-empty');
      const empty = el('div', 'empty', severityFilter ? T('emptyState') : T('emptyNext'));
      if (!severityFilter) {
        const actions = el('div', 'next-steps');
        for (const [key, type] of [['actionShowMap', 'showMap'], ['actionRunChaos', 'runChaos'], ['actionWalkthrough', 'walkthrough']]) {
          const btn = el('button', 'text-btn', T(key));
          btn.addEventListener('click', () => vscode.postMessage({ type }));
          actions.appendChild(btn);
        }
        empty.appendChild(actions);
      }
      findingsEl.appendChild(empty);
      return;
    }

    for (const group of visible) {
      const worst = severityFilter || group.worst;
      const file = el('div', 'file ' + worst + (openFiles.has(group.fileId) ? ' open' : ''));
      file.dataset.file = group.fileId;
      file.dataset.count = String(group.items.length);

      const row = el('button', 'file-row');
      row.setAttribute('aria-expanded', String(openFiles.has(group.fileId)));
      row.appendChild(badge(worst, 'large'));
      const id = el('span', 'file-id');
      id.appendChild(el('span', 'file-name', group.fileName));
      if (group.folder) id.appendChild(el('span', 'file-folder', group.folder));
      row.appendChild(id);
      const count = el('span', 'count', String(group.items.length));
      const before = previousCounts.get(group.fileId);
      if (before !== undefined && before !== String(group.items.length)) count.classList.add('changed');
      row.append(count, el('span', 'chevron'));
      row.addEventListener('click', () => {
        const open = file.classList.toggle('open');
        row.setAttribute('aria-expanded', String(open));
        if (open) openFiles.add(group.fileId);
        else openFiles.delete(group.fileId);
      });

      const body = el('div', 'file-body');
      const inner = el('div', 'file-inner');
      for (const item of group.items) inner.appendChild(renderFinding(item));
      body.appendChild(inner);
      file.append(row, body);
      findingsEl.appendChild(file);
    }
  }

  function renderSummary(msg) {
    summaryEl.replaceChildren();
    if (!msg.rules) return;
    summaryEl.append(T('summary', { rules: msg.rules, collisions: msg.collisions }) + ' ');
    if (msg.collisions > 0) {
      const btn = el('button', 'text-btn', T('explainCollisions'));
      btn.addEventListener('click', () => vscode.postMessage({ type: 'explainCollisions' }));
      summaryEl.appendChild(btn);
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'access') setAccess(msg);
    else if (msg.type === 'findingsByFile') {
      setCounts(msg.counts);
      renderGroups(msg.groups, msg.systemDisabled);
      if (firstRender) setTimeout(() => document.body.classList.remove('preload'), 80); // rAF não roda com a aba escondida
      firstRender = false;
    } else if (msg.type === 'summary') renderSummary(msg);
    else if (msg.type === 'analyzing') {
      $('analyzingRow').classList.toggle('visible', Boolean(msg.active));
      if (msg.active) $('analyzingText').textContent = T('analyzing', { file: msg.fileName || '' });
    }
  });

  // Só agora o listener existe — a extensão espera este "ready" pra mandar o estado inicial.
  vscode.postMessage({ type: 'ready' });
})();
