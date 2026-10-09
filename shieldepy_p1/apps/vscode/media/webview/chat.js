// Chat do ShielDepy. A extensão já manda cada resposta separada (texto + caminho da correção,
// se houver) — o webview não reparseia nada e nunca devolve o conteúdo do arquivo, só o id do turno.
(function () {
  const vscode = acquireVsCodeApi();
  const initial = window.__INITIAL__ || {};
  const $ = (id) => document.getElementById(id);
  // Textos no idioma escolhido (vêm prontos da extensão).
  const STR = initial.t || {};
  const T = (key, vars) => (STR[key] || key).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? String(vars[name]) : m));
  const SEVERITY_SHAPE = { error: 'error', warning: 'warning', info: 'info' };
  const messagesEl = $('messages');
  const inputBox = $('inputBox');
  const thinkingEl = $('thinking');
  const thinkingTextEl = $('thinkingText');
  const attachmentsRow = $('attachmentsRow');
  const EMPTY_HINT = T('chatEmpty');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let attachments = [];
  const fixButtons = new Map();

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function botIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '-143 0 2341 2341');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M1968.64 1747.09L1027.07 2341L59.3685 1747.56L0 0.715702L1025.84 220.951L2055 0L1968.64 1747.09Z');
    svg.appendChild(path);
    return svg;
  }

  // --- "pensando…" que digita e apaga frases ----------------------------------------------
  const PHRASES = T('thinkingWords').split('|');
  let thinkingActive = false;
  let thinkingTimer = null;

  function stopThinking() {
    thinkingActive = false;
    clearTimeout(thinkingTimer);
    thinkingTextEl.textContent = '';
  }

  function startThinking() {
    if (thinkingActive) return;
    thinkingActive = true;
    let phraseIndex = Math.floor(Math.random() * PHRASES.length);
    const typePhrase = () => {
      const phrase = PHRASES[phraseIndex] + '…';
      let i = 0;
      const type = () => {
        if (!thinkingActive) return;
        thinkingTextEl.textContent = phrase.slice(0, ++i);
        thinkingTimer = setTimeout(i < phrase.length ? type : erase, i < phrase.length ? 32 : 750);
      };
      const erase = () => {
        if (!thinkingActive) return;
        thinkingTextEl.textContent = phrase.slice(0, --i);
        if (i > 0) thinkingTimer = setTimeout(erase, 18);
        else {
          phraseIndex = (phraseIndex + 1) % PHRASES.length;
          thinkingTimer = setTimeout(typePhrase, 150);
        }
      };
      type();
    };
    typePhrase();
  }

  // --- mensagens -------------------------------------------------------------------------
  function clearEmptyHint() {
    const hint = messagesEl.querySelector('.empty-hint');
    if (hint) hint.remove();
  }

  function addTurn(turn, animate) {
    clearEmptyHint();
    const role = turn.role === 'user' ? 'user' : 'assistant';
    const row = el('div', 'turn ' + role + (animate ? ' enter' : ''));
    const avatar = el('span', 'avatar ' + role);
    if (role === 'assistant') avatar.appendChild(botIcon());
    row.appendChild(avatar);

    const content = el('div', 'turn-content');
    if (turn.text) content.appendChild(el('div', 'turn-text', turn.text));
    else content.classList.add('cards-only'); // só o card: sem balão em volta (evita borda dupla)
    if (turn.cards && turn.cards.length) {
      const list = el('div', 'cards');
      for (const card of turn.cards) list.appendChild(renderCard(card));
      content.appendChild(list);
    }
    if (turn.outro) content.appendChild(el('div', 'turn-text turn-outro', turn.outro));
    if (turn.fixPath) {
      const btn = el('button', 'action-btn', T('applyFix', { path: turn.fixPath }));
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = T('applying');
        vscode.postMessage({ type: 'applyFix', turnId: turn.id });
      });
      fixButtons.set(turn.id, btn);
      content.appendChild(btn);
    }
    row.appendChild(content);
    messagesEl.appendChild(row);
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: animate ? 'smooth' : 'auto' });
  }

  /**
   * Achado citado como card: fechado mostra só forma, #n e a frase; aberto mostra onde está,
   * com quem conflita e o porquê — o texto longo que a IA lê, só que fácil de ler.
   */
  function renderCard(card) {
    const sev = SEVERITY_SHAPE[card.severity] || 'info';
    const box = el('div', 'card ' + sev);
    const head = el('button', 'card-head');
    head.setAttribute('aria-expanded', 'false');
    head.append(el('span', 'shape ' + sev), el('span', 'card-ref', '#' + card.ref), el('span', 'card-title', card.message), el('span', 'card-chevron'));
    const body = el('div', 'card-body');
    const inner = el('div', 'card-inner');
    const where = el('div', 'card-where', T('cardFileLine', { file: card.fileName, n: card.line + 1 }));
    if (card.conflicts && card.conflicts.length) where.appendChild(el('span', 'card-conflict', ' ' + T('conflictWith', { files: card.conflicts.join(', ') })));
    inner.appendChild(where);
    if (card.impact) {
      inner.appendChild(el('div', 'card-label', T('cardWhy')));
      // Frases em linhas próprias: o parágrafo de impacto fica escaneável.
      for (const sentence of card.impact.split(/(?<=[.!?])\s+/)) if (sentence.trim()) inner.appendChild(el('p', 'card-sentence', sentence.trim()));
    }
    body.appendChild(inner);
    head.addEventListener('click', () => {
      const open = box.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
    });
    box.append(head, body);
    return box;
  }

  // --- bloqueio: só quando a empresa desliga a IA (sem conta, vale a chave do usuário) ------
  const BLOCK_TEXT = { suspended: 'lockSuspendedText', repoBlocked: 'lockRepoText', noGit: 'lockNoGitText', aiDisabled: 'lockAiOffText' };
  let locked = false;
  function setAccess(block, company, remote) {
    locked = Boolean(block);
    $('lock').hidden = !locked;
    for (const id of ['messages', 'inputRow']) $(id).hidden = locked;
    if (locked) {
      thinkingEl.classList.remove('visible');
      stopThinking();
      attachmentsRow.classList.remove('visible');
    } else renderAttachments();
    syncComposer();
    if (!locked) return;
    const kind = block === 'repoBlocked' && !remote ? 'noGit' : block;
    $('lock').className = 'lock ' + (block === 'suspended' ? 'suspended' : 'blocked');
    $('lockTitle').textContent = T('chatSuspendedTitle');
    $('lockText').textContent = T(BLOCK_TEXT[kind] || 'lockAiOffText', { company: company || T('yourCompany'), remote: remote || '' });
    const action = $('lockAction');
    action.textContent = T('checkAgain');
    action.disabled = false;
    action.onclick = () => {
      action.disabled = true;
      vscode.postMessage({ type: 'refreshAccess' });
      setTimeout(() => (action.disabled = false), 2500);
    };
  }

  function addKeyButton() {
    const last = messagesEl.lastElementChild;
    const content = last && last.querySelector('.turn-content');
    if (!content) return;
    const btn = el('button', 'action-btn', T('configureKey'));
    btn.addEventListener('click', () => vscode.postMessage({ type: 'configureKey' }));
    content.appendChild(btn);
  }

  // --- anexos ("Ask AI" na sidebar) -------------------------------------------------------
  function renderAttachments() {
    attachmentsRow.classList.toggle('visible', attachments.length > 0 && !locked);
    attachmentsRow.replaceChildren();
    for (const a of attachments) {
      const chip = el('div', 'attachment-chip');
      chip.appendChild(el('span', '', '#' + (a.ref || a.id) + '  ' + (a.fileName || '').split('/').pop() + ':' + (a.line + 1)));
      const remove = el('button', '', '×');
      remove.title = T('removeAttachment');
      remove.addEventListener('click', () => {
        attachments = attachments.filter((x) => x.id !== a.id);
        renderAttachments();
        syncComposer();
      });
      chip.appendChild(remove);
      attachmentsRow.appendChild(chip);
    }
  }

  function send() {
    const text = inputBox.value;
    if (locked || (!text.trim() && attachments.length === 0)) return;
    const sendBtn = $('sendBtn');
    sendBtn.classList.remove('sent');
    void sendBtn.offsetWidth;
    sendBtn.classList.add('sent');
    vscode.postMessage({ type: 'send', text: text, attachments: attachments });
    attachments = [];
    renderAttachments();
    inputBox.value = '';
    saveDraft();
  }

  // Rascunho sobrevive a reload da janela (retainContextWhenHidden cobre só esconder/mostrar).
  function saveDraft() {
    vscode.setState({ draft: inputBox.value });
    syncComposer();
  }
  // Caixa cresce com o texto (até um limite) e o botão de enviar só acende com algo pra mandar.
  function syncComposer() {
    inputBox.style.height = 'auto';
    inputBox.style.height = Math.min(inputBox.scrollHeight, 140) + 'px';
    // Barra de rolagem só quando passou do limite — antes disso ela aparecia à toa com as setinhas.
    inputBox.style.overflowY = inputBox.scrollHeight > 140 ? 'auto' : 'hidden';
    $('sendBtn').disabled = locked || (!inputBox.value.trim() && attachments.length === 0);
  }
  const saved = vscode.getState();
  if (saved && saved.draft) inputBox.value = saved.draft;
  inputBox.addEventListener('input', saveDraft);

  $('sendBtn').addEventListener('click', send);
  $('stopBtn').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  inputBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    switch (msg.type) {
      case 'history':
        messagesEl.replaceChildren();
        if (!msg.turns || msg.turns.length === 0) messagesEl.appendChild(el('div', 'empty-hint', EMPTY_HINT));
        else msg.turns.forEach((t) => addTurn(t, false));
        break;
      case 'append':
        addTurn(msg.turn, true);
        break;
      case 'access':
        setAccess(msg.block, msg.company, msg.remote);
        break;
      case 'attach':
        if (!attachments.some((a) => a.id === msg.finding.id)) attachments.push(msg.finding);
        renderAttachments();
        syncComposer();
        inputBox.focus();
        break;
      case 'thinking':
        thinkingEl.classList.toggle('visible', Boolean(msg.value));
        if (msg.value) startThinking();
        else stopThinking();
        break;
      case 'needsKey':
        addKeyButton();
        break;
      case 'fixApplied': {
        const btn = fixButtons.get(msg.turnId);
        if (btn) btn.textContent = msg.ok ? T('applied') : T('applyFailed');
        break;
      }
    }
  });

  syncComposer();
  vscode.postMessage({ type: 'ready' });
})();
