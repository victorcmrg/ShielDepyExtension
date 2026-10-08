// Handoff navegador → extensão do VS Code: a extensão abre esta tela com um `state`; a pessoa logada
// clica em "Confiar" e o navegador devolve o código pra extensão (vscode://…).
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { postJson } from '../api';
import { AuthPage } from '../layout/AuthPage';

interface DeviceState {
  ceremonyStatus: string;
  loggedIn: boolean;
  email: string | null;
  accessEnabled: boolean | null;
}

export default function DeviceConfirm() {
  const [params] = useSearchParams();
  const state = params.get('state');
  const navigate = useNavigate();
  const [status, setStatus] = useState('Verificando sessão…');
  const [blocked, setBlocked] = useState(false);
  const [canConfirm, setCanConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Confirmar dispositivo — ShielDepy';
  }, []);

  useEffect(() => {
    if (!state) {
      window.location.href = '/';
      return;
    }
    let cancelled = false;
    (async () => {
      let data: DeviceState;
      try {
        const res = await fetch('/api/device/state?state=' + encodeURIComponent(state), { credentials: 'same-origin' });
        data = await res.json();
      } catch {
        if (!cancelled) setStatus('Algo deu errado. Tente novamente a partir do VS Code.');
        return;
      }
      if (cancelled) return;
      if (data.ceremonyStatus === 'expired') {
        setStatus('Solicitação expirada. Volte para o VS Code e clique em "Entrar" de novo.');
        return;
      }
      if (!data.loggedIn) {
        navigate('/login?device_state=' + encodeURIComponent(state), { replace: true });
        return;
      }
      if (data.accessEnabled === false) {
        setStatus(`O acesso da empresa de ${data.email} está suspenso — não é possível conectar o VS Code agora. Fale com o administrador.`);
        setBlocked(true);
        return;
      }
      setStatus(`${data.email} está autorizando a extensão ShielDepy a conectar com sua conta.`);
      setCanConfirm(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [state, navigate]);

  async function confirm() {
    setBusy(true);
    try {
      const data = await postJson<{ redirectUri: string }>('/api/device/confirm', { state }, 'falha ao confirmar');
      setStatus('Conectado! Volte para o VS Code — ele já deve estar liberado.');
      setCanConfirm(false);
      window.location.href = data.redirectUri;
    } catch (err) {
      setStatus('Algo deu errado: ' + (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthPage>
      <div className={'auth-card' + (blocked ? ' is-blocked' : '')} id="card">
        <p className="muted" id="status">
          {status}
        </p>
        <div id="content">
          {canConfirm && (
            <button className="primary" onClick={confirm} disabled={busy}>
              {busy ? 'Confirmando…' : 'Confiar'}
            </button>
          )}
        </div>
      </div>
    </AuthPage>
  );
}
