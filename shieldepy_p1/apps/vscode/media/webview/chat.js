// Chat do ShielDepy. A extensão já manda cada resposta separada (texto + caminho da correção,
// se houver) — o webview não reparseia nada e nunca devolve o conteúdo do arquivo, só o id do turno.
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const messagesEl = $('messages');
  const inputBox = $('inputBox');
  const thinkingEl = $('thinking');
  const thinkingTextEl = $('thinkingText');
  const attachmentsRow = $('attachmentsRow');
  const EMPTY_HINT = 'Pergunte sobre um erro, peça uma correção, ou peça pra analisar a pasta inteira.';
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
  const PHRASES = ['misturando', 'processando', 'protegendo', 'canalizando', 'mapeando', 'rastreando', 'decifrando', 'tecendo o grafo', 'conectando pontas', 'vasculhando', 'blindando'];
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

  function addTurn(turn) {
    clearEmptyHint();
    const role = turn.role === 'user' ? 'user' : 'assistant';
    const row = el('div', 'turn ' + role);
    const avatar = el('span', 'avatar ' + role);
    if (role === 'assistant') avatar.appendChild(botIcon());
    row.appendChild(avatar);

    const content = el('div', 'turn-content');
    content.appendChild(el('div', 'turn-text', turn.text));
    if (turn.fixPath) {
      const btn = el('button', 'action-btn', 'Aplicar correção em ' + turn.fixPath);
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = 'Aplicando…';
        vscode.postMessage({ type: 'applyFix', turnId: turn.id });
      });
      fixButtons.set(turn.id, btn);
      content.appendChild(btn);
    }
    row.appendChild(content);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addKeyButton() {
    const last = messagesEl.lastElementChild;
    const content = last && last.querySelector('.turn-content');
    if (!content) return;
    const btn = el('button', 'action-btn', 'Configurar chave da IA');
    btn.addEventListener('click', () => vscode.postMessage({ type: 'configureKey' }));
    content.appendChild(btn);
  }

  // --- anexos ("Ask AI" na sidebar) -------------------------------------------------------
  function renderAttachments() {
    attachmentsRow.classList.toggle('visible', attachments.length > 0);
    attachmentsRow.replaceChildren();
    for (const a of attachments) {
      const chip = el('div', 'attachment-chip');
      chip.appendChild(el('span', '', '#' + a.id + ' · ' + (a.fileName || '') + ':' + (a.line + 1)));
      const remove = el('button', '', '×');
      remove.title = 'Remover anexo';
      remove.addEventListener('click', () => {
        attachments = attachments.filter((x) => x.id !== a.id);
        renderAttachments();
      });
      chip.appendChild(remove);
      attachmentsRow.appendChild(chip);
    }
  }

  function send() {
    const text = inputBox.value;
    if (!text.trim() && attachments.length === 0) return;
    vscode.postMessage({ type: 'send', text: text, attachments: attachments });
    attachments = [];
    renderAttachments();
    inputBox.value = '';
    saveDraft();
  }

  // Rascunho sobrevive a reload da janela (retainContextWhenHidden cobre só esconder/mostrar).
  function saveDraft() {
    vscode.setState({ draft: inputBox.value });
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
        else msg.turns.forEach(addTurn);
        break;
      case 'append':
        addTurn(msg.turn);
        break;
      case 'attach':
        if (!attachments.some((a) => a.id === msg.finding.id)) attachments.push(msg.finding);
        renderAttachments();
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
        if (btn) btn.textContent = msg.ok ? 'Aplicado' : 'Não foi possível aplicar';
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
