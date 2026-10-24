// Usuários reais: criados só no primeiro login bem-sucedido, a partir de um convite (allow-list
// por e-mail da empresa). Sem auto-registro.

export interface User {
  id: number;
  email: string;
  companyId: number;
  passwordHash: string | null;
}

/** Quem está fazendo a requisição (sessão web ou token da extensão). */
export interface AuthUser {
  id: number;
  email: string;
  companyId: number;
}

export interface UserListing {
  id: number;
  email: string;
  companyId: number;
  companyName: string;
  lastLoginAt: number | null;
}

export const MIN_PASSWORD = 8;

/** O e-mail como a conta guarda: sem espaço nas pontas e em minúsculas. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Admin da plataforma: o e-mail configurado em ADMIN_EMAIL. */
export function isPlatformAdmin(email: string, adminEmail: string | undefined): boolean {
  return Boolean(adminEmail) && email.toLowerCase() === adminEmail!.toLowerCase();
}
