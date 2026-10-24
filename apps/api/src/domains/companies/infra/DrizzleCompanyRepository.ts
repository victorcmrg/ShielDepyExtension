// Empresas no Postgres (tabelas companies, company_permissions e email_company_assignments, de
// shared/db/schema.ts). A listagem de membros lê também users e device_tokens (do contexto de
// identidade) só para mostrar.
import { and, asc, count, eq, gt, inArray, isNull, notExists, sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db/postgres';
import { companies, companyPermissions, deviceAuthRequests, deviceTokens, emailCompanyAssignments, users } from '../../../shared/db/schema';
import type { CompanyRepository } from '../application/ports';
import type { Assignment, Company, Member, Role } from '../domain/company';

const COMPANY = { id: companies.id, name: companies.name, createdAt: companies.createdAt };

export class DrizzleCompanyRepository implements CompanyRepository {
  constructor(private readonly db: Db) {}

  /** O convite ainda não virou conta (ninguém entrou com esse e-mail). */
  private notUserYet() {
    return notExists(this.db.select({ id: users.id }).from(users).where(eq(users.email, emailCompanyAssignments.email)));
  }

  async create(name: string, now: number): Promise<Company> {
    const [row] = await this.db.insert(companies).values({ name, createdAt: now }).returning(COMPANY);
    return row!;
  }

  async get(id: number): Promise<Company | null> {
    const [row] = await this.db.select(COMPANY).from(companies).where(eq(companies.id, id));
    return row ?? null;
  }

  list(): Promise<Company[]> {
    return this.db.select(COMPANY).from(companies).orderBy(asc(companies.id));
  }

  async rename(id: number, name: string): Promise<void> {
    await this.db.update(companies).set({ name }).where(eq(companies.id, id));
  }

  async delete(id: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // device_auth_requests.user_id não tem ON DELETE CASCADE — limpa antes dos usuários.
      const ofCompany = tx.select({ id: users.id }).from(users).where(eq(users.companyId, id));
      await tx.delete(deviceAuthRequests).where(inArray(deviceAuthRequests.userId, ofCompany));
      await tx.delete(users).where(eq(users.companyId, id));
      await tx.delete(companies).where(eq(companies.id, id));
    });
  }

  async hasEmail(companyId: number, email: string): Promise<boolean> {
    const user = await this.db.select({ id: users.id }).from(users).where(and(eq(users.companyId, companyId), eq(users.email, email)));
    if (user.length > 0) return true;
    const assignment = await this.db
      .select({ id: emailCompanyAssignments.id })
      .from(emailCompanyAssignments)
      .where(and(eq(emailCompanyAssignments.companyId, companyId), eq(emailCompanyAssignments.email, email)));
    return assignment.length > 0;
  }

  permissionRows(companyId: number): Promise<{ key: string; value: boolean }[]> {
    return this.db.select({ key: companyPermissions.key, value: companyPermissions.value }).from(companyPermissions).where(eq(companyPermissions.companyId, companyId));
  }

  async setPermission(companyId: number, key: string, value: boolean): Promise<void> {
    await this.db
      .insert(companyPermissions)
      .values({ companyId, key, value })
      .onConflictDoUpdate({ target: [companyPermissions.companyId, companyPermissions.key], set: { value } });
  }

  async memberCounts(): Promise<{ members: Map<number, number>; pending: Map<number, number> }> {
    const members = await this.db.select({ companyId: users.companyId, n: count() }).from(users).groupBy(users.companyId);
    const pending = await this.db
      .select({ companyId: emailCompanyAssignments.companyId, n: count() })
      .from(emailCompanyAssignments)
      .where(this.notUserYet())
      .groupBy(emailCompanyAssignments.companyId);
    return {
      members: new Map(members.map((m) => [m.companyId, m.n])),
      pending: new Map(pending.map((p) => [p.companyId, p.n])),
    };
  }

  async members(companyId: number, now: number): Promise<Member[]> {
    const devices = this.db
      .select({ n: count() })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.userId, users.id), isNull(deviceTokens.revokedAt), gt(deviceTokens.expiresAt, now)));
    const active = await this.db
      .select({
        id: users.id,
        email: users.email,
        lastLoginAt: users.lastLoginAt,
        role: sql<Role>`coalesce(${emailCompanyAssignments.role}, 'member')`,
        activeDevices: sql<number>`(${devices})`.mapWith(Number),
      })
      .from(users)
      .leftJoin(emailCompanyAssignments, eq(emailCompanyAssignments.email, users.email))
      .where(eq(users.companyId, companyId))
      .orderBy(asc(users.email));
    const pending = await this.db
      .select({ email: emailCompanyAssignments.email, role: emailCompanyAssignments.role })
      .from(emailCompanyAssignments)
      .where(and(eq(emailCompanyAssignments.companyId, companyId), this.notUserYet()))
      .orderBy(asc(emailCompanyAssignments.email));
    return [
      ...active.map((u) => ({ id: u.id, email: u.email, role: u.role, status: 'active' as const, lastLoginAt: u.lastLoginAt, activeDevices: u.activeDevices })),
      ...pending.map((p) => ({ id: null, email: p.email, role: p.role as Role, status: 'pending' as const, lastLoginAt: null, activeDevices: 0 })),
    ];
  }

  async totals(now: number): Promise<{ users: number; pendingInvites: number; activeDevices: number }> {
    const [u] = await this.db.select({ n: count() }).from(users);
    const [p] = await this.db.select({ n: count() }).from(emailCompanyAssignments).where(this.notUserYet());
    const [d] = await this.db
      .select({ n: count() })
      .from(deviceTokens)
      .where(and(isNull(deviceTokens.revokedAt), gt(deviceTokens.expiresAt, now)));
    return { users: u?.n ?? 0, pendingInvites: p?.n ?? 0, activeDevices: d?.n ?? 0 };
  }

  async assign(email: string, companyId: number, initialPasswordHash: string | null, role: Role | null, now: number): Promise<void> {
    await this.db
      .insert(emailCompanyAssignments)
      .values({ email, companyId, initialPasswordHash, role: role ?? 'member', createdAt: now })
      .onConflictDoUpdate({
        target: emailCompanyAssignments.email,
        set: {
          companyId,
          initialPasswordHash: sql`coalesce(excluded.initial_password_hash, ${emailCompanyAssignments.initialPasswordHash})`,
          // sem papel no convite, quem já tinha papel mantém
          ...(role && { role }),
        },
      });
  }

  async getAssignment(email: string): Promise<Assignment | null> {
    const [row] = await this.db
      .select({ companyId: emailCompanyAssignments.companyId, initialPasswordHash: emailCompanyAssignments.initialPasswordHash })
      .from(emailCompanyAssignments)
      .where(eq(emailCompanyAssignments.email, email));
    return row ?? null;
  }

  async role(email: string): Promise<Role | null> {
    const [row] = await this.db.select({ role: emailCompanyAssignments.role }).from(emailCompanyAssignments).where(eq(emailCompanyAssignments.email, email));
    return (row?.role as Role | undefined) ?? null;
  }

  async setRole(email: string, role: Role): Promise<void> {
    await this.db.update(emailCompanyAssignments).set({ role }).where(eq(emailCompanyAssignments.email, email));
  }

  async countOwners(companyId: number): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(emailCompanyAssignments)
      .where(and(eq(emailCompanyAssignments.companyId, companyId), eq(emailCompanyAssignments.role, 'owner')));
    return row?.n ?? 0;
  }

  async hasUser(email: string): Promise<boolean> {
    const rows = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    return rows.length > 0;
  }

  async removeAssignment(email: string): Promise<void> {
    await this.db.delete(emailCompanyAssignments).where(eq(emailCompanyAssignments.email, email));
  }
}
