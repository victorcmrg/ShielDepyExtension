const $ = (sel) => document.querySelector(sel);

const OAUTH_ERROR_MESSAGES = {
  oauth_invalid: 'não foi possível completar o login social — tente de novo.',
  oauth_expired: 'o link de login social expirou — tente de novo.',
  oauth_failed: 'o provedor de login social não respondeu — tente de novo.',
  not_assigned: 'esse e-mail ainda não foi liberado para nenhuma empresa — peça ao admin.',
};

const params = new URLSearchParams(window.location.search);
const deviceState = params.get('device_state');
const redirectTo = params.get('redirect');
const oauthError = params.get('error');

function showError(message) {
  const box = $('#errorBox');
  box.textContent = message;
  box.classList.remove('hidden');
}

if (oauthError) showError(OAUTH_ERROR_MESSAGES[oauthError] || 'não foi possível entrar.');

// Encaminha o device_state pros botões sociais, pra voltar direto pro device-confirm depois do OAuth.
if (deviceState) {
  for (const id of ['googleBtn', 'githubBtn']) {
    const a = $('#' + id);
    a.href = a.href + '?device_state=' + encodeURIComponent(deviceState);
  }
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const btn = $('#submitBtn');

  btn.disabled = true;
  btn.textContent = 'Entrando…';
  $('#errorBox').classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'não foi possível entrar.');

    // Só aceita redirect interno (começando com "/" e não "//") — nada de mandar pra outro site.
    const safeRedirect = redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : null;
    if (deviceState) window.location.href = '/device-confirm.html?state=' + encodeURIComponent(deviceState);
    else window.location.href = safeRedirect || data.home || '/account.html';
  } catch (err) {
    showError(err.message);
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});
