import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { postJson } from '../api';
import { useAuth } from '../auth';
import { AuthPage } from '../layout/AuthPage';
import { goTo } from '../navigation';

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_invalid: 'não foi possível completar o login social — tente de novo.',
  oauth_expired: 'o link de login social expirou — tente de novo.',
  oauth_failed: 'o provedor de login social não respondeu — tente de novo.',
  not_assigned: 'esse e-mail ainda não foi liberado para nenhuma empresa — peça ao admin.',
};

export default function Login() {
  const [params] = useSearchParams();
  const deviceState = params.get('device_state');
  const redirectTo = params.get('redirect');
  const oauthError = params.get('error');
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? OAUTH_ERROR_MESSAGES[oauthError] || 'não foi possível entrar.' : null);

  useEffect(() => {
    document.title = 'Entrar — ShielDepy';
  }, []);

  // Encaminha o device_state pros botões sociais, pra voltar direto pro device-confirm depois do OAuth.
  const oauthHref = (provider: string) =>
    `/api/auth/oauth/${provider}/start` + (deviceState ? '?device_state=' + encodeURIComponent(deviceState) : '');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await postJson<{ home?: string }>('/api/auth/login', { email: email.trim(), password }, 'não foi possível entrar.');
      await refresh().catch(() => null);
      // Só aceita redirect interno (começando com "/" e não "//") — nada de mandar pra outro site.
      const safeRedirect = redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//') ? redirectTo : null;
      if (deviceState) navigate('/device-confirm?state=' + encodeURIComponent(deviceState));
      else goTo(navigate, safeRedirect || data.home || '/projects');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthPage>
      <div className="auth-card">
        <h1>Entrar na conta</h1>
        <p className="muted">Conecte sua conta à extensão ShielDepy.</p>

        <div id="errorBox" className={'error-box' + (error ? '' : ' hidden')}>
          {error}
        </div>

        <form id="loginForm" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input type="email" id="email" placeholder="voce@empresa.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input type="password" id="password" placeholder="••••••••" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="primary" id="submitBtn" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <div className="divider">ou continue com</div>
        <div className="oauth-row">
          <a id="googleBtn" className="btn-secondary" href={oauthHref('google')}>
            Google
          </a>
          <a id="githubBtn" className="btn-secondary" href={oauthHref('github')}>
            GitHub
          </a>
        </div>
      </div>

      <a className="back-link" href="/">
        ← Voltar para o início
      </a>
    </AuthPage>
  );
}
