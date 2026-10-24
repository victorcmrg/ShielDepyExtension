// Casos de uso de empresas: CRUD (admin da plataforma), permissões, convites, papéis e a
// listagem da equipe. Quem pode fazer cada coisa (admin, dono) é checado na rota.
import { hashPassword } from '../../../shared/crypto/passwords';
import { isAccessEnabled, permissionsFrom, type Assignment, type Company, type CompanyWithPermissions, type Member, type Overview, type Permissions, type Role } from '../domain/company';
import type { CompanyRepository } from './ports';

export class CompanyService {
  constructor(
    private readonly repo: CompanyRepository,
    private readonly now: () => number = Date.now
  ) {}

  create(name: string): Promise<Company> {
    return this.repo.create(name, this.now());
  }

  get(id: number): Promise<Company | null> {
    return this.repo.get(id);
  }

  rename(id: number, name: string): Promise<void> {
    return this.repo.rename(id, name);
  }

  delete(id: number): Promise<void> {
    return this.repo.delete(id);
  }

  hasEmail(companyId: number, email: string): Promise<boolean> {
    return this.repo.hasEmail(companyId, email.toLowerCase());
  }

  async permissions(companyId: number): Promise<Permissions> {
    return permissionsFrom(await this.repo.permissionRows(companyId));
  }

  async accessEnabled(companyId: number): Promise<boolean> {
    return isAccessEnabled(await this.permissions(companyId));
  }

  setPermission(companyId: number, key: string, value: boolean): Promise<void> {
    return this.repo.setPermission(companyId, key, value);
  }

  async listWithPermissions(): Promise<CompanyWithPermissions[]> {
    const { members, pending } = await this.repo.memberCounts();
    const list: CompanyWithPermissions[] = [];
    for (const c of await this.repo.list()) {
      list.push({ ...c, permissions: await this.permissions(c.id), memberCount: members.get(c.id) ?? 0, pendingCount: pending.get(c.id) ?? 0 });
    }
    return list;
  }

  members(companyId: number): Promise<Member[]> {
    return this.repo.members(companyId, this.now());
  }

  /** Colegas da mesma empresa — só o que um membro comum pode ver (e-mail + se já entrou). */
  async teammates(companyId: number): Promise<{ email: string; status: 'active' | 'pending' }[]> {
    return (await this.members(companyId)).map((m) => ({ email: m.email, status: m.status }));
  }

  async isMember(companyId: number, email: string): Promise<boolean> {
    const e = email.toLowerCase();
    return (await this.members(companyId)).some((m) => m.email.toLowerCase() === e);
  }

  async overview(): Promise<Overview> {
    const perms: Permissions[] = [];
    for (const c of await this.repo.list()) perms.push(await this.permissions(c.id));
    return {
      companies: perms.length,
      suspendedCompanies: perms.filter((p) => !p.accessEnabled).length,
      aiCompanies: perms.filter((p) => p.aiEnabled).length,
      ...(await this.repo.totals(this.now())),
    };
  }

  /** Libera o e-mail na empresa (convite). Sem `role`, quem já tinha papel mantém; quem é novo vira membro. */
  assign(email: string, companyId: number, initialPassword?: string | null, role?: Role): Promise<void> {
    const hash = initialPassword ? hashPassword(initialPassword) : null;
    return this.repo.assign(email.toLowerCase(), companyId, hash, role ?? null, this.now());
  }

  getAssignment(email: string): Promise<Assignment | null> {
    return this.repo.getAssignment(email.toLowerCase());
  }

  /** Papel do e-mail na empresa dele ('member' se não houver registro). */
  async role(email: string): Promise<Role> {
    return (await this.repo.role(email.toLowerCase())) === 'owner' ? 'owner' : 'member';
  }

  setRole(email: string, role: Role): Promise<void> {
    return this.repo.setRole(email.toLowerCase(), role);
  }

  countOwners(companyId: number): Promise<number> {
    return this.repo.countOwners(companyId);
  }

  /** Tira o convite; quem já tem conta sai removendo o usuário, não o convite. */
  async removeAssignment(email: string): Promise<{ ok: true } | { ok: false; reason: 'user_exists' }> {
    const e = email.toLowerCase();
    if (await this.repo.hasUser(e)) return { ok: false, reason: 'user_exists' };
    await this.repo.removeAssignment(e);
    return { ok: true };
  }
}
