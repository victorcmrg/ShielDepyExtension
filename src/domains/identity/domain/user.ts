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

/**
 * Admin da plataforma: o e-mail configurado em ADMIN_EMAIL. Com o login de teste ligado, a conta de
 * teste também é (é ela que o "Entrar" encenado abre, para cair no painel de empresas).
 */
export function isPlatformAdmin(email: string, adminEmail: string | undefined, testLogin = false): boolean {
  const e = email.toLowerCase();
  if (testLogin && e === TEST_LOGIN_EMAIL) return true;
  return Boolean(adminEmail) && e === adminEmail!.toLowerCase();
}

/** A conta que o login de teste abre, sem e-mail nem senha (só em desenvolvimento). */
export const TEST_LOGIN_EMAIL = 'teste@shieldepy.test';
/** A empresa criada para ela na primeira vez. */
export const TEST_LOGIN_COMPANY = 'ShielDepy (teste)';

/**
 * Login de teste: só com SHIELDEPY_TEST_LOGIN=1 (o `npm run web:dev` liga) e nunca com
 * NODE_ENV=production. Desligado, a rota nem existe (404) e a conta de teste perde o admin.
 */
export function testLoginEnabled(env: { SHIELDEPY_TEST_LOGIN?: string; NODE_ENV?: string }): boolean {
  return env.SHIELDEPY_TEST_LOGIN === '1' && env.NODE_ENV !== 'production';
}
