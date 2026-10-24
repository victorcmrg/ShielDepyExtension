// Google e GitHub pelo fetch nativo. As credenciais e a base do redirect vêm do ambiente.
import type { OAuthClient } from '../application/ports';
import { pickVerifiedEmail, type OAuthProfile, type OAuthProvider } from '../domain/oauth';

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

function callbackUrl(provider: OAuthProvider): string {
  const base = process.env.OAUTH_REDIRECT_BASE ?? 'http://localhost:3001';
  return `${base}/api/auth/oauth/${provider}/callback`;
}

export class HttpOAuthClient implements OAuthClient {
  hasCredentials(provider: OAuthProvider): boolean {
    const cfg = providerConfig(provider);
    return Boolean(cfg.clientId && cfg.clientSecret);
  }

  authorizeUrl(provider: OAuthProvider, state: string): string {
    const cfg = providerConfig(provider);
    const params = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: callbackUrl(provider), response_type: 'code', scope: cfg.scope, state });
    return `${cfg.authorizeUrl}?${params.toString()}`;
  }

  async profile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
    const cfg = providerConfig(provider);

    if (provider === 'google') {
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, grant_type: 'authorization_code', redirect_uri: callbackUrl(provider) }),
      });
      if (!tokenRes.ok) throw new Error('falha ao trocar código com o Google');
      const tokenBody = (await tokenRes.json()) as { access_token: string };

      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { authorization: `Bearer ${tokenBody.access_token}` } });
      if (!profileRes.ok) throw new Error('falha ao buscar perfil do Google');
      const profile = (await profileRes.json()) as { sub: string; email?: string };
      if (!profile.email) throw new Error('Google não retornou e-mail');
      return { providerUserId: profile.sub, email: profile.email.toLowerCase() };
    }

    // github
    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: callbackUrl(provider) }),
    });
    if (!tokenRes.ok) throw new Error('falha ao trocar código com o GitHub');
    const tokenBody = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenBody.access_token) throw new Error(tokenBody.error ?? 'GitHub não retornou access_token');

    const headers = { authorization: `Bearer ${tokenBody.access_token}`, 'user-agent': 'shieldepy-auth' };
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error('falha ao buscar perfil do GitHub');
    const user = (await userRes.json()) as { id: number; email: string | null };

    let email = user.email;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
      if (emailsRes.ok) email = pickVerifiedEmail((await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[]);
    }
    if (!email) throw new Error('GitHub não retornou e-mail verificado');
    return { providerUserId: String(user.id), email: email.toLowerCase() };
  }
}
