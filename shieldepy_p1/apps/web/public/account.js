(async function () {
  const { api, el, icon, run, modal, relativeTime, stagger } = window.sd;
  const me = await window.shieldepyAuthReady;
  if (!me) return;

  const statusEl = document.getElementById('status');
  const devicesEl = document.getElementById('devices');
  const teamEl = document.getElementById('team');
  const openTool = document.getElementById('openToolBtn');
  openTool.append(icon('grid'), el('span', '', 'Ver meus projetos'));

  let account = null;

  async function load() {
    account = await api('/api/account');
    render();
  }

  function statusCard({ iconName, label, value, sub, tone }) {
    const card = el('div', 'stat-card status-' + tone);
    const top = el('div', 'stat-top');
    top.append(icon(iconName), el('span', 'stat-label', label));
    const val = el('div', 'stat-value small');
    val.append(el('span', 'status-dot'), el('span', '', value));
    card.append(top, val, el('div', 'stat-sub', sub));
    return card;
  }

  function render() {
    const access = account.permissions.accessEnabled !== false;
    const ai = Boolean(account.permissions.aiEnabled);
    document.getElementById('greeting').textContent = 'Olá, ' + account.email.split('@')[0];
    document.getElementById('companyEyebrow').textContent = account.companyName;

    statusEl.replaceChildren(
      statusCard({
        iconName: access ? 'shield' : 'lock',
        label: 'Acesso da empresa',
        value: access ? 'Liberado' : 'Suspenso',
        sub: access ? 'A extensão e a ferramenta web funcionam normalmente.' : 'Fale com o administrador pra reativar.',
        tone: access ? 'ok' : 'danger',
      }),
      statusCard({
        iconName: 'spark',
        label: 'Bot de IA',
        value: !access ? 'Pausado' : ai ? 'Liberado' : 'Não liberado',
        sub: !access
          ? 'Sem efeito enquanto o acesso da empresa estiver suspenso.'
          : ai
            ? 'Chat, explicações e sugestões com IA.'
            : 'Ciclos e colisões seguem sendo provados sem IA.',
        tone: ai && access ? 'brand' : 'muted',
      }),
      statusCard({
        iconName: 'device',
        label: 'VS Codes conectados',
        value: String(account.devices.length),
        sub: account.devices.length ? 'último uso ' + relativeTime(account.devices[0].lastUsedAt) : 'nenhum ainda — veja como conectar ao lado',
        tone: account.devices.length ? 'ok' : 'muted',
      })
    );
    stagger([...statusEl.children]);

    renderDevices();
    renderTeam();

    const hasPassword = account.hasPassword;
    document.getElementById('passwordTitle').textContent = hasPassword ? 'Trocar senha' : 'Definir senha';
    document.getElementById('currentField').hidden = !hasPassword;
  }

  function renderDevices() {
    devicesEl.replaceChildren();
    if (account.devices.length === 0) {
      const empty = el('div', 'empty-state compact');
      empty.append(icon('device'), el('strong', '', 'Nenhum VS Code conectado'), el('p', '', 'Quando você entrar pela extensão, ele aparece aqui.'));
      devicesEl.appendChild(empty);
      return;
    }
    const list = el('ul', 'device-list');
    for (const d of account.devices) {
      const li = el('li', 'device');
      const info = el('div', 'device-info');
      info.append(el('strong', '', d.label), el('span', '', 'conectado ' + relativeTime(d.createdAt) + ' · último uso ' + relativeTime(d.lastUsedAt)));
      const btn = el('button', 'text-btn danger', 'Desconectar');
      btn.type = 'button';
      btn.addEventListener('click', async () => {
        const ok = await modal({
          title: 'Desconectar "' + d.label + '"?',
          body: 'Esse VS Code perde o acesso na hora e precisa entrar de novo.',
          confirmLabel: 'Desconectar',
          danger: true,
        });
        if (!ok) return;
        li.classList.add('leaving');
        await run(async () => {
          await api('/api/account/devices/' + d.id, { method: 'DELETE' });
          await load();
        }, 'VS Code desconectado');
      });
      li.append(icon('device'), info, btn);
      list.appendChild(li);
    }
    devicesEl.appendChild(list);
    stagger([...list.children]);
  }

  function renderTeam() {
    teamEl.replaceChildren();
    for (const t of account.teammates) {
      const li = el('li', 'team-member ' + t.status);
      li.append(
        el('span', 'team-avatar', t.email.charAt(0).toUpperCase()),
        el('span', 'team-email', t.email + (t.email === account.email ? ' (você)' : '')),
        el('span', 'badge ' + (t.status === 'active' ? 'badge-ok' : 'badge-muted'), t.status === 'active' ? 'ativo' : 'pendente')
      );
      teamEl.appendChild(li);
    }
    stagger([...teamEl.children]);
  }

  openTool.addEventListener('click', (e) => {
    if (openTool.classList.contains('disabled')) e.preventDefault();
  });

  // ---------- senha ----------
  const newPassword = document.getElementById('newPassword');
  const strengthBars = [...document.querySelectorAll('#strength span')];
  function strength(pw) {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
    return score;
  }
  newPassword.addEventListener('input', () => {
    const s = newPassword.value ? strength(newPassword.value) : 0;
    strengthBars.forEach((bar, i) => bar.classList.toggle('on', i < s));
    document.getElementById('strength').dataset.level = String(s);
  });

  document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = document.getElementById('currentPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    if (newPassword.value !== confirm) {
      window.sd.toast('A confirmação não bate com a nova senha.', 'error');
      return;
    }
    const btn = document.getElementById('passwordBtn');
    btn.disabled = true;
    const ok = await run(
      () => api('/api/account/password', { method: 'POST', body: { currentPassword: current, newPassword: newPassword.value } }),
      'Senha salva'
    );
    btn.disabled = false;
    if (ok) {
      e.target.reset();
      strengthBars.forEach((bar) => bar.classList.remove('on'));
      await load();
    }
  });

  await run(load);
})();
