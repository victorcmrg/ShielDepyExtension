// Dados de demonstração pra testar cada tipo de conta. Pode rodar de novo: recria a empresa demo.
//   npm run seed:demo -w @shieldepy/api
// Senhas fixas e públicas — só pra ambiente local, nunca em produção.
import { db } from '../shared/db/sqlite';
import { addEmailAssignment, createCompany, createUserFromAssignment, deleteCompany, getAssignment, setCompanyPermission } from './companies';
import { hashPassword } from '../shared/crypto/passwords';
import { projects } from '../composition';
import { normalizeRemote } from '../domains/projects/domain/remote';

const DEMO_COMPANY = 'Acme Logística (demo)';
const THIS_REPO = 'https://github.com/victorcmrg/ShielDepyExtension.git';

export const DEMO_ACCOUNTS = [
  { email: 'dono@acme.test', password: 'Acme-Dono-2026', role: 'owner' as const, login: true },
  { email: 'ana@acme.test', password: 'Acme-Ana-2026', role: 'member' as const, login: true },
  { email: 'bruno@acme.test', password: 'Acme-Bruno-2026', role: 'member' as const, login: true },
  { email: 'carla@acme.test', password: 'Acme-Carla-2026', role: 'member' as const, login: false }, // convite ainda não aceito
];

function seed(): void {
  const old = db.prepare(`SELECT id FROM companies WHERE name = ?`).get(DEMO_COMPANY) as { id: number } | undefined;
  if (old) {
    // Convites pendentes não têm usuário, então não saem em cascata — limpa antes.
    db.prepare(`DELETE FROM email_company_assignments WHERE company_id = ?`).run(old.id);
    deleteCompany(old.id);
  }

  const company = createCompany(DEMO_COMPANY);
  setCompanyPermission(company.id, 'aiEnabled', true);

  const now = Date.now();
  for (const a of DEMO_ACCOUNTS) {
    addEmailAssignment(a.email, company.id, a.password, a.role);
    if (a.login) {
      const user = createUserFromAssignment(a.email, company.id, hashPassword(a.password));
      db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now - Math.floor(Math.random() * 3) * 3_600_000, user.id);
    }
  }

  const pedidos = projects.create(company.id, 'Pedidos', 'Microserviços de pedidos, preço e imposto.');
  projects.addRepo(pedidos.id, THIS_REPO);
  projects.addRepo(pedidos.id, 'git@github.com:acme/pedidos-api.git');
  projects.addMember(pedidos.id, 'ana@acme.test');
  projects.addMember(pedidos.id, 'bruno@acme.test');
  projects.addMember(pedidos.id, 'carla@acme.test');

  const loja = projects.create(company.id, 'Loja online', 'Site da loja em React e o checkout.');
  projects.addRepo(loja.id, 'https://github.com/acme/loja-web');
  projects.addMember(loja.id, 'ana@acme.test');

  projects.create(company.id, 'Relatórios', 'Ainda sem repositório: o dono conecta quando o time começar.');

  // Uso que a extensão teria registrado (é o que vira "em uso por … há …" no painel).
  const activity = (projectId: number, remote: string, email: string, branch: string, minutesAgo: number) => {
    const repo = db
      .prepare(`SELECT id FROM project_repos WHERE project_id = ? AND remote = ?`)
      .get(projectId, normalizeRemote(remote)) as { id: number };
    db.prepare(`INSERT INTO repo_activity (repo_id, email, branch, last_seen_at) VALUES (?, ?, ?, ?)`).run(repo.id, email, branch, now - minutesAgo * 60_000);
  };
  activity(pedidos.id, THIS_REPO, 'ana@acme.test', 'main', 4);
  activity(pedidos.id, THIS_REPO, 'bruno@acme.test', 'fix/imposto', 95);
  activity(pedidos.id, 'git@github.com:acme/pedidos-api.git', 'bruno@acme.test', 'main', 60 * 30);

  // A empresa do admin da plataforma também ganha um projeto com este repositório, pra testar a extensão.
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  const adminAssignment = adminEmail ? getAssignment(adminEmail) : null;
  if (adminEmail && adminAssignment) {
    db.prepare(`UPDATE email_company_assignments SET role = 'owner' WHERE email = ?`).run(adminEmail);
    const has = db
      .prepare(`SELECT 1 FROM project_repos r JOIN projects p ON p.id = r.project_id WHERE p.company_id = ? AND r.remote = ?`)
      .get(adminAssignment.companyId, normalizeRemote(THIS_REPO));
    if (!has) {
      const p = projects.create(adminAssignment.companyId, 'ShielDepy', 'A própria extensão e o site.');
      projects.addRepo(p.id, THIS_REPO);
    }
  }

  console.log(`Empresa "${DEMO_COMPANY}" recriada com ${DEMO_ACCOUNTS.length} contas e 3 projetos.`);
  for (const a of DEMO_ACCOUNTS) console.log(`  ${a.role === 'owner' ? 'dono  ' : 'membro'}  ${a.email}  ${a.password}${a.login ? '' : '  (convite pendente)'}`);
}

seed();
