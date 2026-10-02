// Login social (Google/GitHub). Client OAuth confidencial — client_secret e a troca
// do código nunca saem do servidor, então `state` sozinho basta contra CSRF (PKCE
// existe pra proteger clientes públicos, que não é o nosso caso).
import { randomToken } from './tokens';
import { db } from './db';

export type OAuthProvider = 'google' | 'github';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}

function providerConfig(provider: OAuthProvider): ProviderConfig {
  if (provider === 'google') {
    return {
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      scope: 'openid email profile',
    };
  }
  return {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    scope: 'read:user user:email',
  };
}

export function hasCredentials(provider: OAuthProvider): boolean {
  const cfg = providerConfig(provider);
  return Boolean(cfg.clientId && cfg.clientSecret);
}

function redirectBase(): string {
  return process.env.OAUTH_REDIRECT_BASE ?? 'http://localhost:3000';
}

function callbackUrl(provider: OAuthProvider): string {
  return `${redirectBase()}/api/auth/oauth/${provider}/callback`;
}

export function createOAuthState(provider: OAuthProvider, redirectContext: string | null): string {
  const state = randomToken(24);
  const now = Date.now();
  db.prepare(
    `INSERT INTO oauth_states (state, provider, redirect_context, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).run(state, provider, redirectContext, now, now + OAUTH_STATE_TTL_MS);
  return state;
}

export function buildAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const cfg = providerConfig(provider);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: callbackUrl(provider),
    response_type: 'code',
    scope: cfg.scope,
    state,
  });
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

export function consumeOAuthState(state: string, provider: OAuthProvider): { redirectContext: string | null } | null {
  const row = db
    .prepare(
      `SELECT redirect_context as redirectContext, expires_at as expiresAt, consumed_at as consumedAt, provider
       FROM oauth_states WHERE state = ?`
    )
    .get(state) as
    | { redirectContext: string | null; expiresAt: number; consumedAt: number | null; provider: string }
    | undefined;
  if (!row || row.provider !== provider || row.consumedAt || row.expiresAt < Date.now()) return null;
  db.prepare(`UPDATE oauth_states SET consumed_at = ? WHERE state = ?`).run(Date.now(), state);
  return { redirectContext: row.redirectContext };
}

interface OAuthProfile {
  providerUserId: string;
  email: string;
}

export async function exchangeCodeForProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
  const cfg = providerConfig(provider);

  if (provider === 'google') {
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(provider),
      }),
    });
    if (!tokenRes.ok) throw new Error('falha ao trocar código com o Google');
    const tokenBody = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileRes.ok) throw new Error('falha ao buscar perfil do Google');
    const profile = (await profileRes.json()) as { sub: string; email?: string };
    if (!profile.email) throw new Error('Google não retornou e-mail');
    return { providerUserId: profile.sub, email: profile.email.toLowerCase() };
  }

  // github
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: callbackUrl(provider),
    }),
  });
  if (!tokenRes.ok) throw new Error('falha ao trocar código com o GitHub');
  const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenBody.access_token) throw new Error(tokenBody.error ?? 'GitHub não retornou access_token');

  const userRes = await fetch('https://api.github.com/user', {
    headers: { authorization: `Bearer ${tokenBody.access_token}`, 'user-agent': 'shieldepy-auth' },
  });
  if (!userRes.ok) throw new Error('falha ao buscar perfil do GitHub');
  const user = (await userRes.json()) as { id: number; email: string | null };

  let email = user.email;
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: { authorization: `Bearer ${tokenBody.access_token}`, 'user-agent': 'shieldepy-auth' },
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
      email = (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))?.email ?? null;
    }
  }
  if (!email) throw new Error('GitHub não retornou e-mail verificado');
  return { providerUserId: String(user.id), email: email.toLowerCase() };
}
