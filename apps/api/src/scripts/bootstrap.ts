// Script manual de bootstrap: cria a primeira empresa e atribui o e-mail do admin,
// quebrando o ovo-e-galinha (os endpoints /api/admin/* já exigem um usuário
// vinculado a uma empresa, que só esses mesmos endpoints poderiam criar).
//
// Rodar uma vez, depois de definir ADMIN_EMAIL no .env da raiz:
//   npm run bootstrap -w @shieldepy/api
import { companies, database } from '../composition';

const adminEmail = process.env.ADMIN_EMAIL;
if (!adminEmail) {
  console.error('defina ADMIN_EMAIL no .env antes de rodar o bootstrap');
  process.exit(1);
}

try {
  if (await companies.getAssignment(adminEmail)) {
    console.log(`${adminEmail} já está atribuído a uma empresa — nada a fazer.`);
  } else {
    const company = await companies.create('ShielDepy (admin)');
    await companies.setPermission(company.id, 'aiEnabled', true);
    await companies.assign(adminEmail, company.id, null, 'owner');
    console.log(`Empresa "${company.name}" criada (id ${company.id}) e ${adminEmail} atribuído, com aiEnabled=true.`);
    console.log('Entre pela primeira vez usando login social (Google/GitHub) ou peça uma senha inicial via /admin.');
  }
} finally {
  // o PGlite só grava no disco ao fechar
  await database.close();
}
