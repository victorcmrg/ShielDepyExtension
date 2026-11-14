// Login social (Google/GitHub). Client OAuth confidencial — client_secret e a troca do código
// nunca saem do servidor, então `state` sozinho basta contra CSRF (PKCE existe pra proteger
// clientes públicos, que não é o nosso caso).

export type OAuthProvider = 'google' | 'github';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos

export interface OAuthProfile {
  providerUserId: string;
  email: string;
}

export const parseProvider = (raw: string): OAuthProvider | null => (raw === 'google' || raw === 'github' ? raw : null);

/** O state é de uso único, do mesmo provedor e no prazo. */
export function canConsumeState(s: { provider: string; consumedAt: number | null; expiresAt: number }, provider: OAuthProvider, now: number): boolean {
  return s.provider === provider && !s.consumedAt && s.expiresAt >= now;
}

/** GitHub sem e-mail público: o principal verificado, senão qualquer verificado. */
export function pickVerifiedEmail(emails: { email: string; primary: boolean; verified: boolean }[]): string | null {
  return (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))?.email ?? null;
}

/** O login social pode ter começado na cerimônia da extensão: o state dela volta no contexto. */
export function deviceStateFrom(redirectContext: string | null): string | undefined {
  try {
    const parsed = redirectContext ? (JSON.parse(redirectContext) as { deviceState?: unknown }) : {};
    return typeof parsed.deviceState === 'string' ? parsed.deviceState : undefined;
  } catch {
    return undefined; // contexto malformado — ignora e segue pro painel
  }
}

export const redirectContextFor = (deviceState: string | null): string | null => (deviceState ? JSON.stringify({ deviceState }) : null);
