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

  create(name: string): Company {
    return this.repo.create(name, this.now());
  }

  get(id: number): Company | null {
    return this.repo.get(id);
  }

  rename(id: number, name: string): void {
    this.repo.rename(id, name);
  }

  delete(id: number): void {
    this.repo.delete(id);
  }

  hasEmail(companyId: number, email: string): boolean {
    return this.repo.hasEmail(companyId, email.toLowerCase());
  }

  permissions(companyId: number): Permissions {
    return permissionsFrom(this.repo.permissionRows(companyId));
  }

  accessEnabled(companyId: number): boolean {
    return isAccessEnabled(this.permissions(companyId));
  }

  setPermission(companyId: number, key: string, value: boolean): void {
    this.repo.setPermission(companyId, key, value);
  }

  listWithPermissions(): CompanyWithPermissions[] {
    const { members, pending } = this.repo.memberCounts();
    return this.repo.list().map((c) => ({
      ...c,
      permissions: this.permissions(c.id),
      memberCount: members.get(c.id) ?? 0,
      pendingCount: pending.get(c.id) ?? 0,
    }));
  }

  members(companyId: number): Member[] {
    return this.repo.members(companyId, this.now());
  }

  /** Colegas da mesma empresa — só o que um membro comum pode ver (e-mail + se já entrou). */
  teammates(companyId: number): { email: string; status: 'active' | 'pending' }[] {
    return this.members(companyId).map((m) => ({ email: m.email, status: m.status }));
  }

  isMember(companyId: number, email: string): boolean {
    const e = email.toLowerCase();
    return this.members(companyId).some((m) => m.email.toLowerCase() === e);
  }

  overview(): Overview {
    const perms = this.repo.list().map((c) => this.permissions(c.id));
    return {
      companies: perms.length,
      suspendedCompanies: perms.filter((p) => !p.accessEnabled).length,
      aiCompanies: perms.filter((p) => p.aiEnabled).length,
      ...this.repo.totals(this.now()),
    };
  }

  /** Libera o e-mail na empresa (convite). Sem `role`, quem já tinha papel mantém; quem é novo vira membro. */
  assign(email: string, companyId: number, initialPassword?: string | null, role?: Role): void {
    const hash = initialPassword ? hashPassword(initialPassword) : null;
    this.repo.assign(email.toLowerCase(), companyId, hash, role ?? null, this.now());
  }

  getAssignment(email: string): Assignment | null {
    return this.repo.getAssignment(email.toLowerCase());
  }

  /** Papel do e-mail na empresa dele ('member' se não houver registro). */
  role(email: string): Role {
    return this.repo.role(email.toLowerCase()) === 'owner' ? 'owner' : 'member';
  }

  setRole(email: string, role: Role): void {
    this.repo.setRole(email.toLowerCase(), role);
  }

  countOwners(companyId: number): number {
    return this.repo.countOwners(companyId);
  }

  /** Tira o convite; quem já tem conta sai removendo o usuário, não o convite. */
  removeAssignment(email: string): { ok: true } | { ok: false; reason: 'user_exists' } {
    const e = email.toLowerCase();
    if (this.repo.hasUser(e)) return { ok: false, reason: 'user_exists' };
    this.repo.removeAssignment(e);
    return { ok: true };
  }
}
