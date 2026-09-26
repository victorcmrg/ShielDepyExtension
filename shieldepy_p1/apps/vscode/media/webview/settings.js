(function () {
  const vscode = acquireVsCodeApi();
  const initial = window.__INITIAL__ || {};
  const $ = (id) => document.getElementById(id);
  const systemToggle = $('systemToggle');
  const systemLabel = $('systemLabel');
  const ENGINES = { anthropic: 'Claude (Anthropic)', gemini: 'Gemini (Google)', offline: 'nenhuma — modo offline' };

  function radioGroup(container, name, options, messageType) {
    for (const opt of options) {
      const label = document.createElement('label');
      label.className = 'option-row';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = opt.code;
      input.addEventListener('change', () => {
        if (input.checked) vscode.postMessage({ type: messageType, value: input.value });
      });
      const text = document.createElement('span');
      text.textContent = opt.label;
      label.append(input, text);
      container.appendChild(label);
    }
  }
  radioGroup($('providers'), 'provider', initial.providers || [], 'setProvider');
  radioGroup($('languages'), 'language', initial.languages || [], 'setLanguage');

  function setSystem(enabled) {
    systemToggle.checked = enabled;
    systemLabel.textContent = enabled ? 'Ativo' : 'Desativado';
    systemLabel.classList.toggle('active', enabled);
  }

  systemToggle.addEventListener('change', () => {
    vscode.postMessage({ type: 'toggleSystem', value: systemToggle.checked });
    setSystem(systemToggle.checked);
  });
  $('keyBtn').addEventListener('click', () => vscode.postMessage({ type: 'configureKey' }));

  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'sync') return;
    setSystem(Boolean(msg.systemEnabled));
    document.querySelectorAll('input[name="language"]').forEach((i) => (i.checked = i.value === msg.language));
    document.querySelectorAll('input[name="provider"]').forEach((i) => (i.checked = i.value === msg.provider));
    $('engineStatus').textContent = 'IA ativa agora: ' + (ENGINES[msg.engine] || msg.engine);
  });

  vscode.postMessage({ type: 'ready' });
})();
