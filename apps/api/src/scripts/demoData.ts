// Dados de demonstração pra testar cada tipo de conta. Pode rodar de novo: recria a empresa demo.
// Quem roda: `npm run seed:demo -w @shieldepy/api` (seedDemo.ts) e a demo do TCC (scripts/demo/seed.ts),
// que fecham o banco depois.
// Senhas fixas e públicas — só pra ambiente local, nunca em produção.
import { and, eq } from 'drizzle-orm';
import { DrizzleUserRepository } from '../domains/identity/infra/DrizzleIdentityRepositories';
import { normalizeRemote } from '../domains/projects/domain/remote';
import { companies as companiesTable, emailCompanyAssignments, projectRepos, projects as projectsTable, repoActivity, users } from '../shared/db/schema';
import { hashPassword } from '../shared/crypto/passwords';
import { companies, database, projects } from '../composition';

const DEMO_COMPANY = 'Acme Logística (demo)';
const THIS_REPO = 'https://github.com/victorcmrg/ShielDepyExtension.git';

export const DEMO_ACCOUNTS = [
  { email: 'dono@acme.test', password: 'Acme-Dono-2026', role: 'owner' as const, login: true },
  { email: 'ana@acme.test', password: 'Acme-Ana-2026', role: 'member' as const, login: true },
  { email: 'bruno@acme.test', password: 'Acme-Bruno-2026', role: 'member' as const, login: true },
  { email: 'carla@acme.test', password: 'Acme-Carla-2026', role: 'member' as const, login: false }, // convite ainda não aceito
];

export async function seedDemo(): Promise<void> {
  const { db } = database;
  const [old] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.name, DEMO_COMPANY));
  if (old) {
    // Convites pendentes não têm usuário, então não saem em cascata — limpa antes.
    await db.delete(emailCompanyAssignments).where(eq(emailCompanyAssignments.companyId, old.id));
    await companies.delete(old.id);
  }

  const company = await companies.create(DEMO_COMPANY);
  await companies.setPermission(company.id, 'aiEnabled', true);

  const now = Date.now();
  for (const a of DEMO_ACCOUNTS) {
    await companies.assign(a.email, company.id, a.password, a.role);
    if (a.login) {
      const user = await new DrizzleUserRepository(db).create(a.email, company.id, hashPassword(a.password), now);
      await db
        .update(users)
        .set({ lastLoginAt: now - Math.floor(Math.random() * 3) * 3_600_000 })
        .where(eq(users.id, user.id));
    }
  }

  const pedidos = await projects.create(company.id, 'Pedidos', 'Microserviços de pedidos, preço e imposto.');
  await projects.addRepo(pedidos.id, THIS_REPO);
  await projects.addRepo(pedidos.id, 'git@github.com:acme/pedidos-api.git');
  await projects.addMember(pedidos.id, 'ana@acme.test');
  await projects.addMember(pedidos.id, 'bruno@acme.test');
  await projects.addMember(pedidos.id, 'carla@acme.test');

  const loja = await projects.create(company.id, 'Loja online', 'Site da loja em React e o checkout.');
  await projects.addRepo(loja.id, 'https://github.com/acme/loja-web');
  await projects.addMember(loja.id, 'ana@acme.test');

  await projects.create(company.id, 'Relatórios', 'Ainda sem repositório: o dono conecta quando o time começar.');

  // Uso que a extensão teria registrado (é o que vira "em uso por … há …" no painel).
  const activity = async (projectId: number, remote: string, email: string, branch: string, minutesAgo: number) => {
    const repoId = (await projects.repoIdByRemote(projectId, remote))!;
    await db.insert(repoActivity).values({ repoId, email, branch, lastSeenAt: now - minutesAgo * 60_000 });
  };
  await activity(pedidos.id, THIS_REPO, 'ana@acme.test', 'main', 4);
  await activity(pedidos.id, THIS_REPO, 'bruno@acme.test', 'fix/imposto', 95);
  await activity(pedidos.id, 'git@github.com:acme/pedidos-api.git', 'bruno@acme.test', 'main', 60 * 30);

  // A empresa do admin da plataforma também ganha um projeto com este repositório, pra testar a extensão.
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const adminAssignment = adminEmail ? await companies.getAssignment(adminEmail) : null;
  if (adminEmail && adminAssignment) {
    await companies.setRole(adminEmail, 'owner');
    const has = await db
      .select({ id: projectRepos.id })
      .from(projectRepos)
      .innerJoin(projectsTable, eq(projectsTable.id, projectRepos.projectId))
      .where(and(eq(projectsTable.companyId, adminAssignment.companyId), eq(projectRepos.remote, normalizeRemote(THIS_REPO)!)));
    if (has.length === 0) {
      const p = await projects.create(adminAssignment.companyId, 'ShielDepy', 'A própria extensão e o site.');
      await projects.addRepo(p.id, THIS_REPO);
    }
  }

  console.log(`Empresa "${DEMO_COMPANY}" recriada com ${DEMO_ACCOUNTS.length} contas e 3 projetos.`);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role === 'owner' ? 'dono  ' : 'membro'}  ${a.email}  ${a.password}${a.login ? '' : '  (convite pendente)'}`);
}
