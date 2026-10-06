(function () {
  const vscode = acquireVsCodeApi();
  const initial = window.__INITIAL__ || {};
  const $ = (id) => document.getElementById(id);
  // Textos no idioma escolhido (vêm prontos da extensão).
  const STR = initial.t || {};
  const T = (key, vars) => (STR[key] || key).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  const idleRange = $('idleRange');
  const excludeBox = $('excludeBox');
  const excludeSave = $('excludeSave');
  const ENGINES = { anthropic: T('engineAnthropic'), gemini: T('engineGemini'), offline: T('engineOffline') };
  const STATES = { active: T('stateActive'), suspended: T('stateSuspended'), loggedOut: T('stateLoggedOut'), repoBlocked: T('stateRepoBlocked') };
  const label = (list, code) => (list.find((o) => o.code === code) || {}).label || '';
  let savedExclude = '';

  // Sem transições até o primeiro "sync": abrir a aba não anima os switches de desligado pra ligado.
  document.body.classList.add('preload');

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // --- gavetas: uma aberta por vez, mostrando o valor atual na linha fechada --------------
  const drawers = [...document.querySelectorAll('.drawer')];
  for (const drawer of drawers) {
    const button = drawer.querySelector('.row-button');
    button.addEventListener('click', () => {
      const opening = !drawer.classList.contains('open');
      for (const d of drawers) {
        d.classList.toggle('open', d === drawer && opening);
        d.querySelector('.row-button').setAttribute('aria-expanded', String(d === drawer && opening));
      }
      if (opening && drawer.dataset.drawer === 'severity') requestAnimationFrame(() => setSeverity(currentSeverity));
    });
  }

  // --- listas com marca de seleção (no lugar de botões de rádio) --------------------------
  function choiceList(container, name, options, messageType, onPick) {
    for (const opt of options) {
      const item = el('label', 'choice');
      const input = el('input');
      input.type = 'radio';
      input.name = name;
      input.value = opt.code;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        vscode.postMessage({ type: messageType, value: input.value });
        if (onPick) onPick(input.value);
      });
      const text = el('span', 'choice-text');
      text.appendChild(el('span', 'choice-label', opt.label));
      if (opt.hint) text.appendChild(el('span', 'choice-hint', opt.hint));
      item.append(input, text, el('span', 'check'));
      container.appendChild(item);
    }
  }
  const triggers = initial.triggers || [];
  const providers = initial.providers || [];
  const languages = initial.languages || [];
  choiceList($('triggers'), 'trigger', triggers, 'setTrigger', (v) => {
    syncIdle(v);
    $('triggerValue').textContent = (triggers.find((tr) => tr.code === v) || {}).short || '';
  });
  choiceList($('providers'), 'provider', providers, 'setProvider', (v) => ($('providerValue').textContent = label(providers, v)));
  choiceList($('languages'), 'language', languages, 'setLanguage', (v) => ($('languageValue').textContent = label(languages, v)));

  // --- controle segmentado de severidade, com a forma de cada nível -----------------------
  const segmented = $('severities');
  const pill = el('span', 'seg-pill');
  segmented.appendChild(pill);
  let currentSeverity = 'info';
  for (const opt of initial.severities || []) {
    const btn = el('button', 'seg-btn');
    btn.dataset.value = opt.code;
    btn.setAttribute('role', 'radio');
    btn.append(el('span', 'shape ' + opt.code), el('span', '', opt.label));
    btn.addEventListener('click', () => {
      setSeverity(opt.code);
      vscode.postMessage({ type: 'setMinSeverity', value: opt.code });
    });
    segmented.appendChild(btn);
  }
  function setSeverity(value) {
    currentSeverity = value;
    const buttons = [...segmented.querySelectorAll('.seg-btn')];
    const active = buttons.find((b) => b.dataset.value === value) || buttons[0];
    buttons.forEach((b) => b.setAttribute('aria-checked', String(b === active)));
    if (!active) return;
    $('severityValue').textContent = label(initial.severities || [], active.dataset.value);
    pill.style.setProperty('--x', active.offsetLeft + 'px');
    pill.style.setProperty('--w', active.offsetWidth + 'px');
  }
  new ResizeObserver(() => setSeverity(currentSeverity)).observe(segmented);

  // --- espera após digitar: mostra ao arrastar, grava ao soltar ---------------------------
  idleRange.min = String(initial.idleMin || 300);
  idleRange.max = String(initial.idleMax || 5000);
  function showIdle(ms) {
    $('idleValue').textContent = (Number(ms) / 1000).toFixed(1).replace('.', ',') + ' s';
    idleRange.style.setProperty('--pct', ((ms - idleRange.min) / (idleRange.max - idleRange.min)) * 100 + '%');
  }
  idleRange.addEventListener('input', () => showIdle(idleRange.value));
  idleRange.addEventListener('change', () => vscode.postMessage({ type: 'setIdle', value: Number(idleRange.value) }));
  function syncIdle(trigger) {
    $('idleRow').hidden = trigger === 'onSave';
  }

  // --- arquivos ignorados -----------------------------------------------------------------
  const parseExclude = () => excludeBox.value.split('\n').map((l) => l.trim()).filter(Boolean);
  function excludeSummary(list) {
    return list.length === 0 ? T('excludeNone') : list.length === 1 ? T('excludeOne') : T('excludeMany', { n: list.length });
  }
  excludeBox.addEventListener('input', () => {
    excludeSave.disabled = parseExclude().join('\n') === savedExclude;
    excludeSave.textContent = T('save');
  });
  excludeSave.addEventListener('click', () => {
    const list = parseExclude();
    vscode.postMessage({ type: 'setExclude', value: list });
    excludeSave.disabled = true;
    excludeSave.textContent = T('saved');
    $('excludeValue').textContent = excludeSummary(list);
  });

  // --- switches e botões ------------------------------------------------------------------
  $('systemToggle').addEventListener('change', (e) => vscode.postMessage({ type: 'toggleSystem', value: e.target.checked }));
  $('inlineToggle').addEventListener('change', (e) => vscode.postMessage({ type: 'toggleInline', value: e.target.checked }));
  $('statusBarToggle').addEventListener('change', (e) => vscode.postMessage({ type: 'toggleStatusBar', value: e.target.checked }));
  $('keyBtn').addEventListener('click', () => vscode.postMessage({ type: 'configureKey' }));
  $('loginBtn').addEventListener('click', () => vscode.postMessage({ type: 'login' }));
  $('logoutBtn').addEventListener('click', () => vscode.postMessage({ type: 'logout' }));
  $('dashboardBtn').addEventListener('click', () => vscode.postMessage({ type: 'openDashboard' }));
  $('refreshBtn').addEventListener('click', () => {
    const btn = $('refreshBtn');
    btn.disabled = true;
    btn.classList.add('busy');
    $('refreshLabel').textContent = T('checking');
    vscode.postMessage({ type: 'refreshAccess' });
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove('busy');
      $('refreshLabel').textContent = T('checkAccess');
    }, 1200);
  });

  function setAccount(me, access, project) {
    const state = me ? access : 'loggedOut';
    $('accountCard').className = 'account ' + state;
    $('accountBadge').textContent = STATES[state] || STATES.loggedOut;
    $('accountBadge').className = 'state ' + state;
    $('accountAvatar').textContent = me ? me.email.charAt(0).toUpperCase() : '';
    $('accountEmail').textContent = me ? me.email : T('noAccount');
    $('accountCompany').textContent = me ? [me.companyName, project && T('projectLabel', { name: project })].filter(Boolean).join(' / ') : T('signInHint');
    $('loginRow').hidden = Boolean(me);
    $('accountActions').hidden = !me;
    $('accountHint').textContent = !me ? '' : state === 'suspended' ? T('suspendedHint') : state === 'repoBlocked' ? T('repoBlockedHint') : '';
    $('accountHint').hidden = !$('accountHint').textContent;
  }

  let synced = false;
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'sync') return;
    setAccount(msg.me, msg.access, msg.project);
    $('systemToggle').checked = Boolean(msg.systemEnabled);
    $('inlineToggle').checked = msg.inlineEnabled !== false;
    $('statusBarToggle').checked = msg.statusBar !== false;
    document.querySelectorAll('input[name="language"]').forEach((i) => (i.checked = i.value === msg.language));
    document.querySelectorAll('input[name="provider"]').forEach((i) => (i.checked = i.value === msg.provider));
    document.querySelectorAll('input[name="trigger"]').forEach((i) => (i.checked = i.value === msg.trigger));
    $('triggerValue').textContent = (triggers.find((tr) => tr.code === msg.trigger) || {}).short || '';
    $('providerValue').textContent = label(providers, msg.provider);
    $('languageValue').textContent = label(languages, msg.language);
    syncIdle(msg.trigger);
    if (document.activeElement !== idleRange) {
      idleRange.value = String(msg.idleMs);
      showIdle(msg.idleMs);
    }
    setSeverity(msg.minSeverity);
    savedExclude = (msg.exclude || []).join('\n');
    $('excludeValue').textContent = excludeSummary(msg.exclude || []);
    if (document.activeElement !== excludeBox) {
      excludeBox.value = savedExclude;
      excludeSave.disabled = true;
    }
    $('engineStatus').textContent = ENGINES[msg.engine] || '';
    if (!synced) {
      synced = true;
      setTimeout(() => document.body.classList.remove('preload'), 80); // já no estado certo, sem animar até ele
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
