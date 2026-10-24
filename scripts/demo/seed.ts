// Semente do portal da demo (`npm run demo`). Roda com SHIELDEPY_DATA_DIR apontando para a pasta
// da demo, num banco novo. Reaproveita o seedDemo (empresa Acme e contas com senha) e acrescenta o
// projeto do sistema da loja com o remote do workspace da demo, o token da extensão e o token de CI.
//   uso: tsx scripts/demo/seed.ts <remote do workspace> <arquivo de saída .json>
import { writeFileSync } from 'node:fs';
import { chaosRuns, projects } from '../../apps/api/src/composition';
import { db } from '../../apps/api/src/shared/db/sqlite';
import { createDeviceToken } from '../../apps/api/src/auth/deviceTokens';
import { createWebSession } from '../../apps/api/src/auth/session';
import { DEMO_ACCOUNTS } from '../../apps/api/src/auth/seedDemo';

const [remote, out] = process.argv.slice(2);
if (!remote || !out) throw new Error('uso: tsx scripts/demo/seed.ts <remote> <saida.json>');

const owner = DEMO_ACCOUNTS.find((a) => a.role === 'owner')!;
const user = db.prepare(`SELECT id, company_id AS companyId FROM users WHERE email = ?`).get(owner.email) as { id: number; companyId: number };

const project = projects.create(user.companyId, 'Sistema da loja (demo do TCC)', 'Checkout com Stripe e Postgres, microserviços de pedidos e relatórios.');
projects.addRepo(project.id, remote);
for (const a of DEMO_ACCOUNTS) if (a.role === 'member') projects.addMember(project.id, a.email);

const deviceToken = createDeviceToken(user.id, 'VS Code da demo');
const ciToken = chaosRuns.createCiToken(project.id, 'demo local', owner.email).token;
// sessão web do dono: o script confere por ela (/api/account) se o VS Code da demo já usou o token
const ownerCookie = createWebSession(user.id).setCookie.split(';')[0];

writeFileSync(out, JSON.stringify({ projectId: project.id, deviceToken, ciToken, ownerCookie, owner: { email: owner.email, password: owner.password } }, null, 2));
console.log(`Projeto "Sistema da loja (demo do TCC)" criado (id ${project.id}) com o repositório ${remote}.`);
