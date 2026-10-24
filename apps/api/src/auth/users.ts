// Usuários reais (criados só no primeiro login bem-sucedido) e as identidades de login social.
// Vão para o domínio identity na S7e.
import { db } from '../shared/db/sqlite';
import { hashPassword } from '../shared/crypto/passwords';

export interface StoredUser {
  id: number;
  email: string;
  companyId: number;
  passwordHash: string | null;
}

export function findUserByEmail(email: string): StoredUser | null {
  const row = db
    .prepare(`SELECT id, email, company_id as companyId, password_hash as passwordHash FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as StoredUser | undefined;
  return row ?? null;
}

export function findUserById(id: number): StoredUser | null {
  const row = db
    .prepare(`SELECT id, email, company_id as companyId, password_hash as passwordHash FROM users WHERE id = ?`)
    .get(id) as StoredUser | undefined;
  return row ?? null;
}

export function createUserFromAssignment(email: string, companyId: number, passwordHash: string | null): StoredUser {
  const now = Date.now();
  const result = db
    .prepare(`INSERT INTO users (email, password_hash, company_id, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)`)
    .run(email.toLowerCase(), passwordHash, companyId, now, now);
  return { id: Number(result.lastInsertRowid), email: email.toLowerCase(), companyId, passwordHash };
}

export function setUserPassword(userId: number, password: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(password), userId);
}

/** Remove o usuário E o e-mail da allow-list (senão ele recriaria a conta no próximo login). */
export function deleteUser(userId: number): void {
  const user = findUserById(userId);
  if (!user) return;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM device_auth_requests WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    db.prepare(`DELETE FROM email_company_assignments WHERE email = ?`).run(user.email);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function touchLastLogin(userId: number): void {
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(Date.now(), userId);
}

export function linkOAuthIdentity(userId: number, provider: 'google' | 'github', providerUserId: string, email: string): void {
  db.prepare(
    `INSERT INTO oauth_identities (user_id, provider, provider_user_id, email, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`
  ).run(userId, provider, providerUserId, email, Date.now());
}

export function findUserByOAuthIdentity(provider: 'google' | 'github', providerUserId: string): StoredUser | null {
  const row = db
    .prepare(
      `SELECT u.id as id, u.email as email, u.company_id as companyId, u.password_hash as passwordHash
       FROM oauth_identities oi JOIN users u ON u.id = oi.user_id
       WHERE oi.provider = ? AND oi.provider_user_id = ?`
    )
    .get(provider, providerUserId) as StoredUser | undefined;
  return row ?? null;
}

export function listUsers(): { id: number; email: string; companyId: number; companyName: string; lastLoginAt: number | null }[] {
  return db
    .prepare(
      `SELECT u.id as id, u.email as email, u.company_id as companyId, c.name as companyName,
              u.last_login_at as lastLoginAt
       FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`
    )
    .all() as unknown as { id: number; email: string; companyId: number; companyName: string; lastLoginAt: number | null }[];
}
