// Painel "Guardião de Arquitetura". Todo texto vindo da extensão entra via textContent — nunca innerHTML.
(function () {
  const vscode = acquireVsCodeApi();
  const initial = window.__INITIAL__ || {};
  const $ = (id) => document.getElementById(id);
  const toggle = $('toggle');
  const status = $('status');
  const findingsEl = $('findings');
  const analyzingRow = $('analyzingRow');
  const analyzingText = $('analyzingText');
  const summaryEl = $('summary');
  const expandedFiles = new Set(); // lembra quais gavetas o usuário abriu entre re-renders
  const SEVERITIES = { error: 'Importante', warning: 'Atenção', info: 'Ajuste leve' };
  const ORIGINS = { colisao: 'colisão', grafo: 'grafo', ia: 'IA' };
  const ENGINES = { anthropic: 'Claude (Anthropic)', gemini: 'Gemini', offline: 'offline — só achados provados' };

  $('graphNotice').hidden = initial.graphReady !== false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setToggle(value) {
    toggle.checked = value;
    status.textContent = value ? 'Protegendo' : 'Pausado';
    status.classList.toggle('active', value);
  }
  setToggle(initial.inlineEnabled !== false);

  toggle.addEventListener('change', () => {
    vscode.postMessage({ type: 'toggle', value: toggle.checked });
    setToggle(toggle.checked);
  });

  function renderFinding(item) {
    const row = el('div', 'finding');
    // Classe só de uma lista fechada — o valor vem da extensão, mas nada de string livre em className/HTML.
    row.appendChild(el('span', 'marker ' + (SEVERITIES[item.severity] ? item.severity : 'info')));
    row.title = (SEVERITIES[item.severity] || '') + (item.impact ? ' — Impacto: ' + item.impact : '');

    const body = el('span', 'finding-body');
    const line = el('div', 'finding-line', 'Linha ' + (item.line + 1) + ' · #' + item.id);
    if (ORIGINS[item.source]) line.appendChild(el('span', 'origin ' + item.source, ORIGINS[item.source]));
    body.appendChild(line);
    body.appendChild(el('div', 'finding-message', item.message));
    row.appendChild(body);
    row.addEventListener('click', () => vscode.postMessage({ type: 'reveal', fileId: item.fileId, line: item.line }));

    const ask = el('button', 'link-btn', 'Ask AI');
    ask.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'askAI', finding: { id: item.id, fileId: item.fileId, fileName: item.fileName, line: item.line, message: item.message } });
    });
    row.appendChild(ask);
    return row;
  }

  function renderGroups(groups, systemDisabled) {
    findingsEl.replaceChildren();
    if (systemDisabled) {
      findingsEl.appendChild(el('div', 'empty', 'Sistema desativado — ative em Configurações (ícone escudo + engrenagem).'));
      return;
    }
    if (!groups || groups.length === 0) {
      findingsEl.appendChild(el('div', 'empty', 'Nenhum problema encontrado ainda.'));
      return;
    }
    for (const group of groups) {
      const island = el('div', 'island' + (expandedFiles.has(group.fileId) ? ' expanded' : ''));
      const header = el('div', 'island-header');
      header.appendChild(el('span', 'island-chevron'));
      header.appendChild(el('span', 'island-name', group.fileName));
      header.appendChild(el('span', 'island-count', String(group.items.length)));
      header.addEventListener('click', () => {
        if (island.classList.toggle('expanded')) expandedFiles.add(group.fileId);
        else expandedFiles.delete(group.fileId);
      });
      const body = el('div', 'island-body');
      for (const item of group.items) body.appendChild(renderFinding(item));
      island.appendChild(header);
      island.appendChild(body);
      findingsEl.appendChild(island);
    }
  }

  function renderSummary(msg) {
    summaryEl.replaceChildren();
    const ia = el('div');
    ia.append('IA: ', el('strong', '', ENGINES[msg.engine] || msg.engine));
    const rules = el('div');
    rules.append('Regras reativas: ', el('strong', '', String(msg.rules)), ' · colisões provadas: ', el('strong', '', String(msg.collisions)));
    summaryEl.append(ia, rules);
    if (msg.collisions > 0) {
      const btn = el('button', 'link-btn', 'Explicar colisões');
      btn.addEventListener('click', () => vscode.postMessage({ type: 'explainCollisions' }));
      summaryEl.appendChild(btn);
    }
  }

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'syncToggle') setToggle(Boolean(msg.value));
    else if (msg.type === 'findingsByFile') renderGroups(msg.groups, msg.systemDisabled);
    else if (msg.type === 'summary') renderSummary(msg);
    else if (msg.type === 'analyzing') {
      analyzingRow.classList.toggle('visible', Boolean(msg.active));
      analyzingText.textContent = msg.active ? 'Analisando ' + (msg.fileName || '') : '';
    }
  });

  // Só agora o listener existe — a extensão espera este "ready" pra mandar o estado inicial.
  vscode.postMessage({ type: 'ready' });
})();
