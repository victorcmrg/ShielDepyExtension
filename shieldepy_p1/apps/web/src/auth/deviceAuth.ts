// A cerimônia de "confiar" a extensão VS Code no navegador (device flow, estilo
// `gh auth login`): a extensão gera um `state`, o navegador confirma logado e emite
// um código de troca de uso único e vida curta, que a extensão troca por um token real.
import { db } from './db';
import { randomToken, sha256Hex } from './tokens';
import { createDeviceToken } from './deviceTokens';

const CEREMONY_TTL_MS = 5 * 60 * 1000; // 5 minutos para completar a cerimônia inteira
const EXCHANGE_CODE_TTL_MS = 90 * 1000; // 90 segundos para trocar o código pelo token

export function createOrGetDeviceAuthRequest(state: string): { status: string } {
  const now = Date.now();
  const existing = db
    .prepare(`SELECT status, expires_at as expiresAt FROM device_auth_requests WHERE state = ?`)
    .get(state) as { status: string; expiresAt: number } | undefined;

  if (existing) {
    if (existing.status === 'pending' && existing.expiresAt < now) {
      db.prepare(`UPDATE device_auth_requests SET status = 'expired' WHERE state = ?`).run(state);
      return { status: 'expired' };
    }
    return { status: existing.status };
  }

  db.prepare(
    `INSERT INTO device_auth_requests (state, status, created_at, expires_at) VALUES (?, 'pending', ?, ?)`
  ).run(state, now, now + CEREMONY_TTL_MS);
  return { status: 'pending' };
}

export function confirmDeviceAuthRequest(state: string, userId: number): { redirectCode: string } | null {
  const now = Date.now();
  const row = db
    .prepare(`SELECT status, expires_at as expiresAt FROM device_auth_requests WHERE state = ?`)
    .get(state) as { status: string; expiresAt: number } | undefined;
  if (!row || row.status !== 'pending' || row.expiresAt < now) return null;

  const rawCode = randomToken(24);
  db.prepare(
    `UPDATE device_auth_requests
     SET status = 'confirmed', user_id = ?, exchange_code_hash = ?, exchange_code_expires_at = ?, confirmed_at = ?
     WHERE state = ?`
  ).run(userId, sha256Hex(rawCode), now + EXCHANGE_CODE_TTL_MS, now, state);
  return { redirectCode: rawCode };
}

export function exchangeCode(rawCode: string, label?: string | null): { token: string } | null {
  const now = Date.now();
  const hash = sha256Hex(rawCode);
  const row = db
    .prepare(
      `SELECT state, status, user_id as userId, exchange_code_expires_at as codeExpiresAt
       FROM device_auth_requests WHERE exchange_code_hash = ?`
    )
    .get(hash) as { state: string; status: string; userId: number | null; codeExpiresAt: number | null } | undefined;

  if (!row || row.status !== 'confirmed' || !row.userId) return null;
  if (row.codeExpiresAt === null || row.codeExpiresAt < now) return null;

  db.prepare(`UPDATE device_auth_requests SET status = 'exchanged', exchanged_at = ? WHERE state = ?`).run(
    now,
    row.state
  );
  return { token: createDeviceToken(row.userId, label) };
}
