// Script manual de bootstrap: cria a primeira empresa e atribui o e-mail do admin,
// quebrando o ovo-e-galinha (os endpoints /api/admin/* já exigem um usuário
// vinculado a uma empresa, que só esses mesmos endpoints poderiam criar).
//
// Rodar uma vez, depois de definir ADMIN_EMAIL no .env da raiz:
//   npm run bootstrap -w @shieldepy/api
import { db } from '../shared/db/sqlite';
import { companies } from '../composition';

const adminEmail = process.env.ADMIN_EMAIL;
if (!adminEmail) {
  console.error('defina ADMIN_EMAIL no .env antes de rodar o bootstrap');
  process.exit(1);
}

const existing = db.prepare(`SELECT id FROM email_company_assignments WHERE email = ?`).get(adminEmail.toLowerCase());

if (existing) {
  console.log(`${adminEmail} já está atribuído a uma empresa — nada a fazer.`);
  process.exit(0);
}

const company = companies.create('ShielDepy (admin)');
companies.setPermission(company.id, 'aiEnabled', true);
companies.assign(adminEmail, company.id, null, 'owner');

console.log(`Empresa "${company.name}" criada (id ${company.id}) e ${adminEmail} atribuído, com aiEnabled=true.`);
console.log('Entre pela primeira vez usando login social (Google/GitHub) ou peça uma senha inicial via /admin.');
