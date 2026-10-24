// O SQL de empresas. As tabelas (companies, company_permissions, email_company_assignments) ainda
// nascem no esquema único de shared/db/sqlite.ts; a P1 passa isso para migrations. A listagem de
// membros lê também users e device_tokens (do contexto de identidade) só para mostrar.
import type { DatabaseSync } from 'node:sqlite';
import type { CompanyRepository } from '../application/ports';
import type { Assignment, Company, Member, Role } from '../domain/company';

export class SqliteCompanyRepository implements CompanyRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(name: string, now: number): Company {
    const result = this.db.prepare(`INSERT INTO companies (name, created_at) VALUES (?, ?)`).run(name, now);
    return { id: Number(result.lastInsertRowid), name, createdAt: now };
  }

  get(id: number): Company | null {
    return (this.db.prepare(`SELECT id, name, created_at as createdAt FROM companies WHERE id = ?`).get(id) as Company | undefined) ?? null;
  }

  list(): Company[] {
    return this.db.prepare(`SELECT id, name, created_at as createdAt FROM companies ORDER BY id`).all() as unknown as Company[];
  }

  rename(id: number, name: string): void {
    this.db.prepare(`UPDATE companies SET name = ? WHERE id = ?`).run(name, id);
  }

  delete(id: number): void {
    this.db.exec('BEGIN');
    try {
      // device_auth_requests.user_id não tem ON DELETE CASCADE — limpa antes dos usuários.
      this.db.prepare(`DELETE FROM device_auth_requests WHERE user_id IN (SELECT id FROM users WHERE company_id = ?)`).run(id);
      this.db.prepare(`DELETE FROM users WHERE company_id = ?`).run(id);
      this.db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  hasEmail(companyId: number, email: string): boolean {
    const user = this.db.prepare(`SELECT 1 FROM users WHERE company_id = ? AND email = ?`).get(companyId, email);
    const assignment = this.db.prepare(`SELECT 1 FROM email_company_assignments WHERE company_id = ? AND email = ?`).get(companyId, email);
    return Boolean(user || assignment);
  }

  permissionRows(companyId: number): { key: string; value: boolean }[] {
    const rows = this.db.prepare(`SELECT key, value FROM company_permissions WHERE company_id = ?`).all(companyId) as { key: string; value: string }[];
    return rows.map((r) => ({ key: r.key, value: r.value === '1' }));
  }

  setPermission(companyId: number, key: string, value: boolean): void {
    this.db
      .prepare(
        `INSERT INTO company_permissions (company_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (company_id, key) DO UPDATE SET value = excluded.value`
      )
      .run(companyId, key, value ? '1' : '0');
  }

  memberCounts(): { members: Map<number, number>; pending: Map<number, number> } {
    const members = this.db.prepare(`SELECT company_id as companyId, COUNT(*) as n FROM users GROUP BY company_id`).all() as { companyId: number; n: number }[];
    const pending = this.db
      .prepare(
        `SELECT a.company_id as companyId, COUNT(*) as n FROM email_company_assignments a
         WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)
         GROUP BY a.company_id`
      )
      .all() as { companyId: number; n: number }[];
    return {
      members: new Map(members.map((m) => [m.companyId, Number(m.n)])),
      pending: new Map(pending.map((p) => [p.companyId, Number(p.n)])),
    };
  }

  members(companyId: number, now: number): Member[] {
    const users = this.db
      .prepare(
        `SELECT u.id as id, u.email as email, u.last_login_at as lastLoginAt,
                COALESCE((SELECT a.role FROM email_company_assignments a WHERE a.email = u.email), 'member') as role,
                (SELECT COUNT(*) FROM device_tokens d
                   WHERE d.user_id = u.id AND d.revoked_at IS NULL AND d.expires_at > ?) as activeDevices
         FROM users u WHERE u.company_id = ? ORDER BY u.email`
      )
      .all(now, companyId) as { id: number; email: string; role: Role; lastLoginAt: number | null; activeDevices: number }[];
    const pending = this.db
      .prepare(
        `SELECT a.email as email, a.role as role FROM email_company_assignments a
         WHERE a.company_id = ? AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)
         ORDER BY a.email`
      )
      .all(companyId) as { email: string; role: Role }[];
    return [
      ...users.map((u) => ({ id: u.id, email: u.email, role: u.role, status: 'active' as const, lastLoginAt: u.lastLoginAt, activeDevices: Number(u.activeDevices) })),
      ...pending.map((p) => ({ id: null, email: p.email, role: p.role, status: 'pending' as const, lastLoginAt: null, activeDevices: 0 })),
    ];
  }

  totals(now: number): { users: number; pendingInvites: number; activeDevices: number } {
    const count = (sql: string, ...params: (string | number)[]) => Number((this.db.prepare(sql).get(...params) as { n: number }).n);
    return {
      users: count(`SELECT COUNT(*) as n FROM users`),
      pendingInvites: count(`SELECT COUNT(*) as n FROM email_company_assignments a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = a.email)`),
      activeDevices: count(`SELECT COUNT(*) as n FROM device_tokens WHERE revoked_at IS NULL AND expires_at > ?`, now),
    };
  }

  assign(email: string, companyId: number, initialPasswordHash: string | null, role: Role | null, now: number): void {
    this.db
      .prepare(
        `INSERT INTO email_company_assignments (email, company_id, initial_password_hash, created_at, role) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (email) DO UPDATE SET company_id = excluded.company_id,
           initial_password_hash = COALESCE(excluded.initial_password_hash, email_company_assignments.initial_password_hash),
           role = CASE WHEN ? IS NULL THEN email_company_assignments.role ELSE excluded.role END`
      )
      .run(email, companyId, initialPasswordHash, now, role ?? 'member', role);
  }

  getAssignment(email: string): Assignment | null {
    const row = this.db
      .prepare(`SELECT company_id as companyId, initial_password_hash as initialPasswordHash FROM email_company_assignments WHERE email = ?`)
      .get(email) as Assignment | undefined;
    return row ?? null;
  }

  role(email: string): Role | null {
    const row = this.db.prepare(`SELECT role FROM email_company_assignments WHERE email = ?`).get(email) as { role: Role } | undefined;
    return row?.role ?? null;
  }

  setRole(email: string, role: Role): void {
    this.db.prepare(`UPDATE email_company_assignments SET role = ? WHERE email = ?`).run(role, email);
  }

  countOwners(companyId: number): number {
    return Number((this.db.prepare(`SELECT COUNT(*) as n FROM email_company_assignments WHERE company_id = ? AND role = 'owner'`).get(companyId) as { n: number }).n);
  }

  hasUser(email: string): boolean {
    return Boolean(this.db.prepare(`SELECT id FROM users WHERE email = ?`).get(email));
  }

  removeAssignment(email: string): void {
    this.db.prepare(`DELETE FROM email_company_assignments WHERE email = ?`).run(email);
  }
}
