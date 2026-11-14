// Cookie da sessão web: httpOnly + Secure + SameSite=Lax. Ele carrega o token opaco; o banco
// guarda só o hash.
import type { IncomingMessage } from 'node:http';

export const SESSION_COOKIE = 'shieldepy_session';
const FORCE_INSECURE_COOKIES = process.env.DEV_INSECURE_COOKIES === '1';

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildSetCookie(name: string, value: string, opts: { maxAgeSeconds?: number; clear?: boolean } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (!FORCE_INSECURE_COOKIES) parts.push('Secure');
  if (opts.clear) parts.push('Max-Age=0');
  else if (opts.maxAgeSeconds) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  return parts.join('; ');
}
