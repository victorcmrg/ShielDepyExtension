// Modelo multi-tenant: empresas ("caixas"), permissões por empresa e a allow-list de e-mails
// atribuídos a uma empresa (pré-cadastro pelo admin ou convite do dono — sem auto-registro).

export interface Company {
  id: number;
  name: string;
  createdAt: number;
}

export type Role = 'owner' | 'member';

/** O convite de um e-mail: a empresa, o papel e a senha inicial (hash), se houver. */
export interface Assignment {
  companyId: number;
  initialPasswordHash: string | null;
}

export interface Member {
  id: number | null;
  email: string;
  role: Role;
  status: 'active' | 'pending';
  lastLoginAt: number | null;
  activeDevices: number;
}

export type Permissions = Record<string, boolean>;

export interface CompanyWithPermissions extends Company {
  permissions: Permissions;
  memberCount: number;
  pendingCount: number;
}

export interface Overview {
  companies: number;
  suspendedCompanies: number;
  users: number;
  pendingInvites: number;
  activeDevices: number;
  aiCompanies: number;
}

/**
 * Permissões padrão de uma empresa sem linha em company_permissions:
 *   accessEnabled — a empresa pode usar a extensão/ferramenta. Padrão liberado: criar a
 *                   empresa já é o ato de dar acesso; suspender é explícito.
 *   aiEnabled     — a empresa pode usar a IA. Padrão bloqueado (custa dinheiro).
 */
export const DEFAULT_PERMISSIONS: Permissions = { accessEnabled: true, aiEnabled: false };
export const PERMISSION_KEYS = new Set(Object.keys(DEFAULT_PERMISSIONS));

export const MAX_COMPANY_NAME = 80;
export const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** As permissões gravadas por cima dos padrões. */
export function permissionsFrom(rows: { key: string; value: boolean }[]): Permissions {
  const perms: Permissions = { ...DEFAULT_PERMISSIONS };
  for (const row of rows) perms[row.key] = row.value;
  return perms;
}

/** A empresa está liberada (só um `false` explícito suspende). */
export const isAccessEnabled = (perms: Permissions): boolean => perms.accessEnabled !== false;

/** Qualquer coisa que não seja 'owner' é membro. */
export const roleFrom = (raw: unknown): Role => (raw === 'owner' ? 'owner' : 'member');

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email);

/** Senha inicial é opcional; se vier, precisa do tamanho mínimo. */
export const isAcceptableInitialPassword = (password: string | null | undefined): boolean => !password || password.length >= MIN_PASSWORD;

/** Rebaixar o último dono deixaria a empresa sem ninguém para montar projetos e equipe. */
export function leavesNoOwner(newRole: Role, currentRole: Role, owners: number): boolean {
  return newRole === 'member' && currentRole === 'owner' && owners <= 1;
}
