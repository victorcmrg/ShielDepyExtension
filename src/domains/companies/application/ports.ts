// O que os casos de uso de empresas precisam do banco. A infra implementa (Postgres com Drizzle).
import type { Assignment, Company, Member, Role } from '../domain/company';

export interface CompanyRepository {
  create(name: string, now: number): Promise<Company>;
  get(id: number): Promise<Company | null>;
  list(): Promise<Company[]>;
  rename(id: number, name: string): Promise<void>;
  /** Exclui a empresa e tudo que pertence a ela (usuários → sessões/dispositivos em cascata). */
  delete(id: number): Promise<void>;
  /** O e-mail é usuário ou convite desta empresa. */
  hasEmail(companyId: number, email: string): Promise<boolean>;

  permissionRows(companyId: number): Promise<{ key: string; value: boolean }[]>;
  setPermission(companyId: number, key: string, value: boolean): Promise<void>;
  /** Usuários e convites pendentes por empresa. */
  memberCounts(): Promise<{ members: Map<number, number>; pending: Map<number, number> }>;
  /** Usuários ativos + e-mails liberados que ainda não entraram nenhuma vez. */
  members(companyId: number, now: number): Promise<Member[]>;
  totals(now: number): Promise<{ users: number; pendingInvites: number; activeDevices: number }>;

  /** Cria ou atualiza o convite; `role` null mantém o papel que já existia. */
  assign(email: string, companyId: number, initialPasswordHash: string | null, role: Role | null, now: number): Promise<void>;
  getAssignment(email: string): Promise<Assignment | null>;
  role(email: string): Promise<Role | null>;
  setRole(email: string, role: Role): Promise<void>;
  countOwners(companyId: number): Promise<number>;
  hasUser(email: string): Promise<boolean>;
  removeAssignment(email: string): Promise<void>;
}
