// O SQL de identidade: usuários e identidades sociais, sessões web, tokens da extensão, a
// cerimônia do device flow e os states do OAuth. As tabelas ainda nascem no esquema único de
// shared/db/sqlite.ts; a P1 passa isso para migrations.
import type { DatabaseSync } from 'node:sqlite';
import type { DeviceAuthRepository, DeviceTokenRepository, OAuthStateRepository, SessionRepository, UserRepository } from '../application/ports';
import type { CeremonyStatus } from '../domain/deviceAuth';
import type { OAuthProvider } from '../domain/oauth';
import type { AuthUser, User, UserListing } from '../domain/user';

const USER_COLUMNS = 'id, email, company_id as companyId, password_hash as passwordHash';

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseSync) {}

  byEmail(email: string): User | null {
    return (this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`).get(email.toLowerCase()) as User | undefined) ?? null;
  }

  byId(id: number): User | null {
    return (this.db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined) ?? null;
  }

  byOAuthIdentity(provider: OAuthProvider, providerUserId: string): User | null {
    const row = this.db
      .prepare(
        `SELECT u.id as id, u.email as email, u.company_id as companyId, u.password_hash as passwordHash
         FROM oauth_identities oi JOIN users u ON u.id = oi.user_id
         WHERE oi.provider = ? AND oi.provider_user_id = ?`
      )
      .get(provider, providerUserId) as User | undefined;
    return row ?? null;
  }

  create(email: string, companyId: number, passwordHash: string | null, now: number): User {
    const e = email.toLowerCase();
    const result = this.db.prepare(`INSERT INTO users (email, password_hash, company_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)`).run(e, passwordHash, companyId, now, now);
    return { id: Number(result.lastInsertRowid), email: e, companyId, passwordHash };
  }

  setPasswordHash(userId: number, hash: string): void {
    this.db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, userId);
  }

  delete(userId: number): void {
    const user = this.byId(userId);
    if (!user) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`DELETE FROM device_auth_requests WHERE user_id = ?`).run(userId);
      this.db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
      this.db.prepare(`DELETE FROM email_company_assignments WHERE email = ?`).run(user.email);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  touchLastLogin(userId: number, now: number): void {
    this.db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now, userId);
  }

  linkOAuthIdentity(userId: number, provider: OAuthProvider, providerUserId: string, email: string, now: number): void {
    this.db
      .prepare(
        `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (provider, provider_user_id) DO NOTHING`
      )
      .run(userId, provider, providerUserId, email, now);
  }

  list(): UserListing[] {
    return this.db
      .prepare(
        `SELECT u.id as id, u.email as email, u.company_id as companyId, c.name as companyName, u.last_login_at as lastLoginAt
         FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`
      )
      .all() as unknown as UserListing[];
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(tokenHash: string, userId: number, now: number, expiresAt: number): void {
    this.db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`).run(tokenHash, userId, now, expiresAt, now);
  }

  find(tokenHash: string): { user: AuthUser; expiresAt: number } | null {
    const row = this.db
      .prepare(
        `SELECT s.expires_at as expiresAt, u.id as id, u.email as email, u.company_id as companyId
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`
      )
      .get(tokenHash) as { expiresAt: number; id: number; email: string; companyId: number } | undefined;
    return row ? { user: { id: row.id, email: row.email, companyId: row.companyId }, expiresAt: row.expiresAt } : null;
  }

  touch(tokenHash: string, now: number): void {
    this.db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).run(now, tokenHash);
  }

  delete(tokenHash: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
  }
}

export class SqliteDeviceTokenRepository implements DeviceTokenRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(tokenHash: string, userId: number, now: number, expiresAt: number, label: string | null): void {
    this.db
      .prepare(`INSERT INTO device_tokens (token_hash, user_id, created_at, expires_at, last_used_at, label) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(tokenHash, userId, now, expiresAt, now, label);
  }

  find(tokenHash: string): { user: AuthUser; expiresAt: number; revokedAt: number | null } | null {
    const row = this.db
      .prepare(
        `SELECT u.id as id, u.email as email, u.company_id as companyId,
                dt.expires_at as expiresAt, dt.revoked_at as revokedAt
         FROM device_tokens dt JOIN users u ON u.id = dt.user_id
         WHERE dt.token_hash = ?`
      )
      .get(tokenHash) as { id: number; email: string; companyId: number; expiresAt: number; revokedAt: number | null } | undefined;
    return row ? { user: { id: row.id, email: row.email, companyId: row.companyId }, expiresAt: row.expiresAt, revokedAt: row.revokedAt } : null;
  }

  slide(tokenHash: string, now: number, expiresAt: number): void {
    this.db.prepare(`UPDATE device_tokens SET last_used_at = ?, expires_at = ? WHERE token_hash = ?`).run(now, expiresAt, tokenHash);
  }

  revokeByHash(tokenHash: string, now: number): void {
    this.db.prepare(`UPDATE device_tokens SET revoked_at = ? WHERE token_hash = ?`).run(now, tokenHash);
  }

  listActive(userId: number, now: number): { id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[] {
    return this.db
      .prepare(
        `SELECT id, label, created_at as createdAt, last_used_at as lastUsedAt FROM device_tokens
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_used_at DESC`
      )
      .all(userId, now) as { id: number; label: string | null; createdAt: number; lastUsedAt: number | null }[];
  }

  revokeById(userId: number, deviceId: number, now: number): boolean {
    return Number(this.db.prepare(`UPDATE device_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(now, deviceId, userId).changes) > 0;
  }

  revokeAll(userId: number, now: number): number {
    return Number(this.db.prepare(`UPDATE device_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(now, userId).changes);
  }
}

export class SqliteDeviceAuthRepository implements DeviceAuthRepository {
  constructor(private readonly db: DatabaseSync) {}

  find(state: string): { status: CeremonyStatus; expiresAt: number } | null {
    return (this.db.prepare(`SELECT status, expires_at as expiresAt FROM device_auth_requests WHERE state = ?`).get(state) as { status: CeremonyStatus; expiresAt: number } | undefined) ?? null;
  }

  create(state: string, now: number, expiresAt: number): void {
    this.db.prepare(`INSERT INTO device_auth_requests (state, status, created_at, expires_at) VALUES (?, 'pending', ?, ?)`).run(state, now, expiresAt);
  }

  markExpired(state: string): void {
    this.db.prepare(`UPDATE device_auth_requests SET status = 'expired' WHERE state = ?`).run(state);
  }

  confirm(state: string, userId: number, codeHash: string, codeExpiresAt: number, now: number): void {
    this.db
      .prepare(
        `UPDATE device_auth_requests
         SET status = 'confirmed', user_id = ?, exchange_code_hash = ?, exchange_code_expires_at = ?, confirmed_at = ?
         WHERE state = ?`
      )
      .run(userId, codeHash, codeExpiresAt, now, state);
  }

  findByCode(codeHash: string): { state: string; status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null } | null {
    const row = this.db
      .prepare(`SELECT state, status, user_id as userId, exchange_code_expires_at as codeExpiresAt FROM device_auth_requests WHERE exchange_code_hash = ?`)
      .get(codeHash) as { state: string; status: CeremonyStatus; userId: number | null; codeExpiresAt: number | null } | undefined;
    return row ?? null;
  }

  markExchanged(state: string, now: number): void {
    this.db.prepare(`UPDATE device_auth_requests SET status = 'exchanged', exchanged_at = ? WHERE state = ?`).run(now, state);
  }
}

export class SqliteOAuthStateRepository implements OAuthStateRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(state: string, provider: OAuthProvider, redirectContext: string | null, now: number, expiresAt: number): void {
    this.db.prepare(`INSERT INTO oauth_states (state, provider, redirect_context, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`).run(state, provider, redirectContext, now, expiresAt);
  }

  find(state: string): { provider: string; redirectContext: string | null; expiresAt: number; consumedAt: number | null } | null {
    const row = this.db
      .prepare(`SELECT redirect_context as redirectContext, expires_at as expiresAt, consumed_at as consumedAt, provider FROM oauth_states WHERE state = ?`)
      .get(state) as { provider: string; redirectContext: string | null; expiresAt: number; consumedAt: number | null } | undefined;
    return row ?? null;
  }

  consume(state: string, now: number): void {
    this.db.prepare(`UPDATE oauth_states SET consumed_at = ? WHERE state = ?`).run(now, state);
  }
}
