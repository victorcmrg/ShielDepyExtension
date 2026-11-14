// Script manual de bootstrap: cria a primeira empresa e atribui o e-mail do admin,
// quebrando o ovo-e-galinha (os endpoints /api/admin/* já exigem um usuário
// vinculado a uma empresa, que só esses mesmos endpoints poderiam criar).
//
// Rodar uma vez, depois de definir ADMIN_EMAIL (e, se quiser, ADMIN_INITIAL_PASSWORD) no .env da raiz:
//   npm run bootstrap -w @shieldepy/api
// Em produção, o start:prod faz o mesmo sozinho a cada subida (decisão 0048).
import { companies, database } from '../composition';
import { bootstrapAdmin } from './bootstrapAdmin';

try {
  const r = await bootstrapAdmin(companies, process.env);
  if (r.status === 'sem-admin') {
    console.error('defina ADMIN_EMAIL no .env antes de rodar o bootstrap');
    process.exitCode = 1;
  } else if (r.status === 'email-invalido') {
    console.error('ADMIN_EMAIL não tem forma de e-mail');
    process.exitCode = 1;
  } else if (r.status === 'senha-curta') {
    console.error('ADMIN_INITIAL_PASSWORD precisa ter pelo menos 8 caracteres');
    process.exitCode = 1;
  } else if (r.status === 'ja-existe') {
    console.log(`${r.email} já está atribuído a uma empresa — nada a fazer.`);
  } else {
    console.log(`Empresa "ShielDepy (admin)" criada e ${r.email} atribuído, com aiEnabled=true.`);
    console.log(r.comSenha ? 'Entre com o e-mail e a senha inicial.' : 'Entre pela primeira vez usando login social (Google/GitHub).');
  }
} finally {
  // o PGlite só grava no disco ao fechar
  await database.close();
}
