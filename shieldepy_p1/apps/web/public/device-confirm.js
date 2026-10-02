const $ = (sel) => document.querySelector(sel);
const state = new URLSearchParams(window.location.search).get('state');

async function main() {
  if (!state) {
    window.location.href = '/';
    return;
  }

  let data;
  try {
    const res = await fetch('/api/device/state?state=' + encodeURIComponent(state), { credentials: 'same-origin' });
    data = await res.json();
  } catch {
    setStatus('Algo deu errado. Tente novamente a partir do VS Code.');
    return;
  }

  if (data.ceremonyStatus === 'expired') {
    setStatus('Solicitação expirada. Volte para o VS Code e clique em "Entrar" de novo.');
    return;
  }
  if (!data.loggedIn) {
    window.location.href = '/login.html?device_state=' + encodeURIComponent(state);
    return;
  }

  if (data.accessEnabled === false) {
    setStatus(`O acesso da empresa de ${data.email} está suspenso — não é possível conectar o VS Code agora. Fale com o administrador.`);
    $('#card').classList.add('is-blocked');
    return;
  }

  setStatus(`${data.email} está autorizando a extensão ShielDepy a conectar com sua conta.`);
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = 'Confiar';
  btn.addEventListener('click', () => confirmDevice(btn));
  $('#content').appendChild(btn);
}

async function confirmDevice(btn) {
  btn.disabled = true;
  btn.textContent = 'Confirmando…';
  try {
    const res = await fetch('/api/device/confirm', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao confirmar');
    setStatus('Conectado! Volte para o VS Code — ele já deve estar liberado.');
    $('#content').innerHTML = '';
    window.location.href = data.redirectUri;
  } catch (err) {
    setStatus('Algo deu errado: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Confiar';
  }
}

function setStatus(text) {
  $('#status').textContent = text;
}

main();
