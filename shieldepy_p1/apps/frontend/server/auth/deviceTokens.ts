// Token de longa duração usado pela extensão VS Code (header Authorization: Bearer).
// Opaco (não JWT) para poder ser revogado na hora — basta marcar a linha no banco.
import { db } from './db';
import { randomToken, sha256Hex } from './tokens';

const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias, renovado a cada uso (sliding)

export interface DeviceInfo {
  id: number;
  label: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export function createDeviceToken(userId: number, label?: string | null): string {
  const raw = `sde_${randomToken(32)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO device_tokens (token_hash, user_id, created_at, expires_at, last_used_at, label) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sha256Hex(raw), userId, now, now + DEVICE_TOKEN_TTL_MS, now, (label ?? '').slice(0, 120) || null);
  return raw;
}

export function getUserByDeviceToken(rawToken: string): { id: number; email: string; companyId: number } | null {
  const hash = sha256Hex(rawToken);
  const row = db
    .prepare(
      `SELECT u.id as id, u.email as email, u.company_id as companyId,
              dt.expires_at as expiresAt, dt.revoked_at as revokedAt
       FROM device_tokens dt JOIN users u ON u.id = dt.user_id
       WHERE dt.token_hash = ?`
    )
    .get(hash) as
    | { id: number; email: string; companyId: number; expiresAt: number; revokedAt: number | null }
    | undefined;
  if (!row || row.revokedAt || row.expiresAt < Date.now()) return null;
  const now = Date.now();
  db.prepare(`UPDATE device_tokens SET last_used_at = ?, expires_at = ? WHERE token_hash = ?`).run(
    now,
    now + DEVICE_TOKEN_TTL_MS,
    hash
  );
  return { id: row.id, email: row.email, companyId: row.companyId };
}

export function revokeDeviceToken(rawToken: string): void {
  db.prepare(`UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ?`).run(Date.now(), sha256Hex(rawToken));
}

/** Dispositivos ainda válidos (não revogados, não expirados) de um usuário. */
export function listDevices(userId: number): DeviceInfo[] {
  const rows = db
    .prepare(
      `SELECT id, label, created_at as createdAt, last_used_at as lastUsedAt FROM device_tokens
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC`
    )
    .all(userId, Date.now()) as { id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[];
  return rows.map((r) => ({ ...r, label: r.label || 'VS Code' }));
}

/** Revoga um dispositivo — só se ele for mesmo deste usuário. */
export function revokeDeviceById(userId: number, deviceId: number): boolean {
  const result = db
    .prepare(`UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`)
    .run(Date.now(), deviceId, userId);
  return Number(result.changes) > 0;
}

export function revokeAllDevices(userId: number): number {
  const result = db
    .prepare(`UPDATE device_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`)
    .run(Date.now(), userId);
  return Number(result.changes);
}
