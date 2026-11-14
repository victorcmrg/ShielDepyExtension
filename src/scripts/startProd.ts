// A subida de produção (decisão 0048): garante o admin da plataforma pelas variáveis de ambiente
// (ADMIN_EMAIL e ADMIN_INITIAL_PASSWORD; só age na primeira vez) e sobe o servidor de sempre. Num
// host sem terminal (a Square Cloud), é o único jeito de o primeiro admin existir.
import { bootstrapAdmin } from './bootstrapAdmin';

const { companies } = await import('../composition');
const r = await bootstrapAdmin(companies, process.env);
const msg: Record<typeof r.status, string> = {
  'sem-admin': 'sem ADMIN_EMAIL: nenhum admin da plataforma criado',
  'email-invalido': 'ADMIN_EMAIL não tem forma de e-mail: nenhum admin criado',
  'senha-curta': 'ADMIN_INITIAL_PASSWORD com menos de 8 caracteres: nenhum admin criado',
  'ja-existe': 'admin da plataforma já existe',
  criado: 'admin da plataforma criado (empresa "ShielDepy (admin)")',
};
console.error(`[web] ${msg[r.status]}${r.status === 'criado' ? (r.comSenha ? ', com a senha inicial' : ', sem senha (login social)') : ''}`);

await import('../server');
