// Semente do portal da demo (`npm run demo`). Roda com SHIELDEPY_DATA_DIR apontando para a pasta
// da demo, num banco novo. Reaproveita os dados de demonstração (empresa Acme e contas com senha) e
// acrescenta o projeto do sistema da loja com o remote do workspace da demo, o token da extensão e o token de CI.
//   uso: tsx scripts/demo/seed.ts <remote do workspace> <arquivo de saída .json>
import { writeFileSync } from 'node:fs';
import { chaosRuns, database, identity, projects } from '../../apps/api/src/composition';
import { SESSION_COOKIE } from '../../apps/api/src/domains/identity/http/cookies';
import { DEMO_ACCOUNTS, seedDemo } from '../../apps/api/src/scripts/demoData';

const [remote, out] = process.argv.slice(2);
if (!remote || !out) throw new Error('uso: tsx scripts/demo/seed.ts <remote> <saida.json>');

try {
  await seedDemo();
  const owner = DEMO_ACCOUNTS.find((a) => a.role === 'owner')!;
  const user = (await identity.userByEmail(owner.email))!;

  const project = await projects.create(user.companyId, 'Sistema da loja (demo do TCC)', 'Checkout com Stripe e Postgres, microserviços de pedidos e relatórios.');
  await projects.addRepo(project.id, remote);
  for (const a of DEMO_ACCOUNTS) if (a.role === 'member') await projects.addMember(project.id, a.email);

  const deviceToken = await identity.issueDeviceToken(user.id, 'VS Code da demo');
  const ciToken = (await chaosRuns.createCiToken(project.id, 'demo local', owner.email)).token;
  // sessão web do dono: o script confere por ela (/api/account) se o VS Code da demo já usou o token
  const ownerCookie = `${SESSION_COOKIE}=${encodeURIComponent((await identity.createSession(user.id)).token)}`;

  writeFileSync(out, JSON.stringify({ projectId: project.id, deviceToken, ciToken, ownerCookie, owner: { email: owner.email, password: owner.password } }, null, 2));
  console.log(`Projeto "Sistema da loja (demo do TCC)" criado (id ${project.id}) com o repositório ${remote}.`);
} finally {
  // o PGlite só grava no disco ao fechar; o portal da demo abre a mesma pasta logo depois
  await database.close();
}
