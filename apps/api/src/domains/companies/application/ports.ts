// O que os casos de uso de empresas precisam do banco. A infra implementa (SQLite hoje, Postgres na P1).
import type { Assignment, Company, Member, Role } from '../domain/company';

export interface CompanyRepository {
  create(name: string, now: number): Company;
  get(id: number): Company | null;
  list(): Company[];
  rename(id: number, name: string): void;
  /** Exclui a empresa e tudo que pertence a ela (usuários → sessões/dispositivos em cascata). */
  delete(id: number): void;
  /** O e-mail é usuário ou convite desta empresa. */
  hasEmail(companyId: number, email: string): boolean;

  permissionRows(companyId: number): { key: string; value: boolean }[];
  setPermission(companyId: number, key: string, value: boolean): void;
  /** Usuários e convites pendentes por empresa. */
  memberCounts(): { members: Map<number, number>; pending: Map<number, number> };
  /** Usuários ativos + e-mails liberados que ainda não entraram nenhuma vez. */
  members(companyId: number, now: number): Member[];
  totals(now: number): { users: number; pendingInvites: number; activeDevices: number };

  /** Cria ou atualiza o convite; `role` null mantém o papel que já existia. */
  assign(email: string, companyId: number, initialPasswordHash: string | null, role: Role | null, now: number): void;
  getAssignment(email: string): Assignment | null;
  role(email: string): Role | null;
  setRole(email: string, role: Role): void;
  countOwners(companyId: number): number;
  hasUser(email: string): boolean;
  removeAssignment(email: string): void;
}
