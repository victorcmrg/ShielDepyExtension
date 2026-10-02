// Modelo multi-tenant: empresas ("caixas"), permissões por empresa, allow-list de
// e-mails atribuídos a uma empresa (pré-cadastro pelo admin — sem auto-registro),
// e os usuários reais (criados só no primeiro login bem-sucedido).
import { db } from './db';
import { hashPassword } from './passwords';

export interface Company {
  id: number;
  name: string;
  createdAt: number;
}

export interface Assignment {
  companyId: number;
  initialPasswordHash: string | null;
}

export interface StoredUser {
  id: number;
  email: string;
  companyId: number;
  passwordHash: string | null;
}

export interface Member {
  id: number | null;
  email: string;
  status: 'active' | 'pending';
  lastLoginAt: number | null;
  activeDevices: number;
}

/**
 * Permissões padrão de uma empresa sem linha em company_permissions:
 *   accessEnabled — a empresa pode usar a extensão/ferramenta. Padrão liberado: criar a
 *                   empresa já é o ato de dar acesso; suspender é explícito.
 *   aiEnabled     — a empresa pode usar a IA. Padrão bloqueado (custa dinheiro).
 */
const DEFAULT_PERMISSIONS: Record<string, boolean> = { accessEnabled: true, aiEnabled: false };

export function createCompany(name: string): Company {
  const now = Date.now();
  const result = db.prepare(`INSERT INTO companies (name, created_at) VALUES (?, ?)`).run(name, now);
  return { id: Number(result.lastInsertRowid), name, createdAt: now };
}

export function getCompanyById(id: number): Company | null {
  const row = db.prepare(`SELECT id, name, created_at as createdAt FROM companies WHERE id = ?`).get(id) as
    | Company
    | undefined;
  return row ?? null;
}

export function listCompanies(): Company[] {
  return db.prepare(`SELECT id, name, created_at as createdAt FROM companies ORDER BY id`).all() as unknown as Company[];
}

export function renameCompany(id: number, name: string): void {
  db.prepare(`UPDATE companies SET name = ? WHERE id = ?`).run(name, id);
}

/** Exclui a empresa e tudo que pertence a ela (usuários → sessões/dispositivos em cascata). */
export function deleteCompany(id: number): void {
  db.exec('BEGIN');
  try {
    // device_auth_requests.user_id não tem ON DELETE CASCADE — limpa antes dos usuários.
    db.prepare(`DELETE FROM device_auth_requests WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`).run(id);
    db.prepare(`DELETE FROM users WHERE company_id = ?`).run(id);
    db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function companyHasEmail(companyId: number, email: string): boolean {
  const e = email.toLowerCase();
  const user = db.prepare(`SELECT 1 FROM users WHERE company_id = ? AND email = ?`).get(companyId, e);
  const assignment = db.prepare(`SELECT 1 FROM email_company_assignments WHERE company_id = ? AND email = ?`).get(companyId, e);
  return Boolean(user || assignment);
}

export function getCompanyPermissions(companyId: number): Record<string, boolean> {
  const rows = db.prepare(`SELECT key, value FROM company_permissions WHERE company_id = ?`).all(companyId) as {
    key: string;
    value: string;
  }[];
  const perms: Record<string, boolean> = { ...DEFAULT_PERMISSIONS };
  for (const row of rows) perms[row.key] = row.value === '1';
  return perms;
}

export function setCompanyPermission(companyId: number, key: string, value: boolean): void {
  db.prepare(
    `INSERT INTO company_permissions (company_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (company_id, key) DO UPDATE SET value = excluded.value`
  ).run(companyId, key, value ? '1' : '0');
}

export function listCompaniesWithPermissions(): (Company & {
  permissions: Record<string, boolean>;
  memberCount: number;
  pendingCount: number;
})[] {
  const members = db.prepare(`SELECT company_id as companyId, COUNT(*) as n FROM users GROUP BY company_id`).all() as {
    companyId: number;
    n: number;
  }[];
  const pending = db
    .prepare(
      `SELECT a.company_id as companyId, COUNT(*) as n FROM email_company_assignments a
       WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)
       GROUP BY a.company_id`
    )
    .all() as { companyId: number; n: number }[];
  const memberMap = new Map(members.map((m) => [m.companyId, Number(m.n)]));
  const pendingMap = new Map(pending.map((p) => [p.companyId, Number(p.n)]));
  return listCompanies().map((c) => ({
    ...c,
    permissions: getCompanyPermissions(c.id),
    memberCount: memberMap.get(c.id) ?? 0,
    pendingCount: pendingMap.get(c.id) ?? 0,
  }));
}

/** Usuários ativos + e-mails liberados que ainda não entraram nenhuma vez. */
export function listCompanyMembers(companyId: number): Member[] {
  const now = Date.now();
  const users = db
    .prepare(
      `SELECT u.id as id, u.email as email, u.last_login_at as lastLoginAt,
              (SELECT COUNT(*) FROM device_tokens d
                 WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.expires_at > ?) as activeDevices
       FROM users u WHERE u.company_id = ? ORDER BY u.email`
    )
    .all(now, companyId) as { id: number; email: string; lastLoginAt: number | null; activeDevices: number }[];
  const pending = db
    .prepare(
      `SELECT a.email as email FROM email_company_assignments a
       WHERE a.company_id = ? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)
       ORDER BY a.email`
    )
    .all(companyId) as { email: string }[];
  return [
    ...users.map((u) => ({ id: u.id, email: u.email, status: 'active' as const, lastLoginAt: u.lastLoginAt, activeDevices: Number(u.activeDevices) })),
    ...pending.map((p) => ({ id: null, email: p.email, status: 'pending' as const, lastLoginAt: null, activeDevices: 0 })),
  ];
}

export function getOverview(): {
  companies: number;
  suspendedCompanies: number;
  users: number;
  pendingInvites: number;
  activeDevices: number;
  aiCompanies: number;
} {
  const count = (sql: string, ...params: (string | number)[]) => Number((db.prepare(sql).get(...params) as { n: number }).n);
  const companies = listCompanies();
  const perms = companies.map((c) => getCompanyPermissions(c.id));
  return {
    companies: companies.length,
    suspendedCompanies: perms.filter((p) => !p.accessEnabled).length,
    aiCompanies: perms.filter((p) => p.aiEnabled).length,
    users: count(`SELECT COUNT(*) as n FROM users`),
    pendingInvites: count(
      `SELECT COUNT(*) as n FROM email_company_assignments a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)`
    ),
    activeDevices: count(`SELECT COUNT(*) as n FROM device_tokens WHERE revoked_at IS NULL AND expires_at > ?`, Date.now()),
  };
}

export function addEmailAssignment(email: string, companyId: number, initialPassword?: string | null): void {
  const now = Date.now();
  const hash = initialPassword ? hashPassword(initialPassword) : null;
  db.prepare(
    `INSERT INTO email_company_assignments (email, company_id, initial_password_hash, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET company_id = excluded.company_id,
       initial_password_hash = COALESCE(excluded.initial_password_hash, email_company_assignments.initial_password_hash)`
  ).run(email.toLowerCase(), companyId, hash, now);
}

export function removeEmailAssignment(email: string): { ok: true } | { ok: false; reason: 'user_exists' } {
  const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase());
  if (existingUser) return { ok: false, reason: 'user_exists' };
  db.prepare(`DELETE FROM email_company_assignments WHERE email = ?`).run(email.toLowerCase());
  return { ok: true };
}

export function getAssignment(email: string): Assignment | null {
  const row = db
    .prepare(
      `SELECT company_id as companyId, initial_password_hash as initialPasswordHash
       FROM email_company_assignments WHERE email = ?`
    )
    .get(email.toLowerCase()) as Assignment | undefined;
  return row ?? null;
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

export function listUsers(): {
  id: number;
  email: string;
  companyId: number;
  companyName: string;
  lastLoginAt: number | null;
}[] {
  return db
    .prepare(
      `SELECT u.id as id, u.email as email, u.company_id as companyId, c.name as companyName,
              u.last_login_at as lastLoginAt
       FROM users u JOIN companies c ON c.id = u.company_id ORDER BY u.id`
    )
    .all() as unknown as {
    id: number;
    email: string;
    companyId: number;
    companyName: string;
    lastLoginAt: number | null;
  }[];
}

/** Colegas da mesma empresa — só o que um membro comum pode ver (e-mail + se já entrou). */
export function listTeammates(companyId: number): { email: string; status: 'active' | 'pending' }[] {
  return listCompanyMembers(companyId).map((m) => ({ email: m.email, status: m.status }));
}
