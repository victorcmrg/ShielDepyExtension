// Semente do portal da demo (`npm run demo`). Roda com SHIELDEPY_DATA_DIR apontando para a pasta
// da demo, num banco novo. Reaproveita o seedDemo (empresa Acme e contas com senha) e acrescenta o
// projeto do sistema da loja com o remote do workspace da demo, o token da extensão e o token de CI.
//   uso: tsx scripts/demo/seed.ts <remote do workspace> <arquivo de saída .json>
import { writeFileSync } from 'node:fs';
import { createCiToken } from '../../apps/frontend/server/auth/chaosRuns';
import { db } from '../../apps/frontend/server/auth/db';
import { createDeviceToken } from '../../apps/frontend/server/auth/deviceTokens';
import { addProjectMember, addRepo, createProject } from '../../apps/frontend/server/auth/projects';
import { DEMO_ACCOUNTS } from '../../apps/frontend/server/auth/seedDemo';

const [remote, out] = process.argv.slice(2);
if (!remote || !out) throw new Error('uso: tsx scripts/demo/seed.ts <remote> <saida.json>');

const owner = DEMO_ACCOUNTS.find((a) => a.role === 'owner')!;
const user = db.prepare(`SELECT id, company_id AS companyId FROM users WHERE email = ?`).get(owner.email) as { id: number; companyId: number };

const project = createProject(user.companyId, 'Sistema da loja (demo do TCC)', 'Checkout com Stripe e Postgres, microserviços de pedidos e relatórios.');
addRepo(project.id, remote);
for (const a of DEMO_ACCOUNTS) if (a.role === 'member') addProjectMember(project.id, a.email);

const deviceToken = createDeviceToken(user.id, 'VS Code da demo');
const ciToken = createCiToken(project.id, 'demo local', owner.email).token;

writeFileSync(out, JSON.stringify({ projectId: project.id, deviceToken, ciToken, owner: { email: owner.email, password: owner.password } }, null, 2));
console.log(`Projeto "Sistema da loja (demo do TCC)" criado (id ${project.id}) com o repositório ${remote}.`);
