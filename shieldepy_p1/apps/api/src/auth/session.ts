// Sessão web (cookie httpOnly + Secure + SameSite=Lax). O cookie carrega um token
// opaco; só o hash SHA-256 dele fica no banco — um vazamento da tabela não expõe
// credenciais utilizáveis. Chamado "session.ts" (singular) pra não colidir com o
// SessionStore de análise em ../sessions.ts (conceito diferente: aquele é sessão de
// chat/análise anônima, este é sessão de login de verdade).
import type { IncomingMessage } from 'node:http';
import { db } from './db';
import { randomToken, sha256Hex } from './tokens';

const COOKIE_NAME = 'shieldepy_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const FORCE_INSECURE_COOKIES = process.env.DEV_INSECURE_COOKIES === '1';

export interface AuthUser {
  id: number;
  email: string;
  companyId: number;
}

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

export function createWebSession(userId: number): { setCookie: string } {
  const rawToken = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  ).run(sha256Hex(rawToken), userId, now, expiresAt, now);
  return { setCookie: buildSetCookie(COOKIE_NAME, rawToken, { maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000) }) };
}

export function getSessionUser(req: IncomingMessage): AuthUser | null {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return null;
  const hash = sha256Hex(raw);
  const row = db
    .prepare(
      `SELECT s.expires_at as expiresAt, u.id as id, u.email as email, u.company_id as companyId
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hash) as { expiresAt: number; id: number; email: string; companyId: number } | undefined;
  if (!row || row.expiresAt < Date.now()) return null;
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).run(Date.now(), hash);
  return { id: row.id, email: row.email, companyId: row.companyId };
}

export function destroySession(req: IncomingMessage): string {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (raw) db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256Hex(raw));
  return buildSetCookie(COOKIE_NAME, '', { clear: true });
}
