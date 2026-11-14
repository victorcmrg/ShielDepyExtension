// O bootstrap do admin da plataforma a partir das variáveis de ambiente (decisão 0048): cria a
// primeira empresa e o convite do ADMIN_EMAIL, com a senha inicial de ADMIN_INITIAL_PASSWORD (ou
// sem senha, para entrar por login social). Roda em toda subida de produção e só age na primeira:
// se o admin já tem empresa, nada muda, nem a senha.
import { isAcceptableInitialPassword, isValidEmail } from '../domains/companies/domain/company';

/** O pedaço do CompanyService que o bootstrap usa (o teste passa um falso). */
export interface BootstrapCompanies {
  getAssignment(email: string): Promise<unknown>;
  create(name: string): Promise<{ id: number }>;
  setPermission(companyId: number, key: string, value: boolean): Promise<void>;
  assign(email: string, companyId: number, initialPassword?: string | null, role?: 'owner'): Promise<void>;
}

export type BootstrapResult =
  | { status: 'sem-admin' }
  | { status: 'email-invalido' }
  | { status: 'senha-curta' }
  | { status: 'ja-existe'; email: string }
  | { status: 'criado'; email: string; comSenha: boolean };

export async function bootstrapAdmin(companies: BootstrapCompanies, env: { ADMIN_EMAIL?: string; ADMIN_INITIAL_PASSWORD?: string }): Promise<BootstrapResult> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return { status: 'sem-admin' };
  if (!isValidEmail(email)) return { status: 'email-invalido' };
  const password = env.ADMIN_INITIAL_PASSWORD || null;
  if (!isAcceptableInitialPassword(password)) return { status: 'senha-curta' };
  if (await companies.getAssignment(email)) return { status: 'ja-existe', email };
  const company = await companies.create('ShielDepy (admin)');
  await companies.setPermission(company.id, 'aiEnabled', true);
  await companies.assign(email, company.id, password, 'owner');
  return { status: 'criado', email, comSenha: password !== null };
}
