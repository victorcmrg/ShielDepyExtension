// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Os testes de caos saem da topologia, mas só o projeto sabe: como subir o app sem abrir porta,
// como zerar o estado, o que nunca pode acontecer e como é uma requisição válida de cada rota.
// Complete as linhas marcadas abaixo (uma marca por pendência) e rode "ShielDepy: Testar Caos"
// (ou `shieldepy chaos .`). As invariantes são opcionais, mas são elas que provam corrida e estado.

import { resetDb } from './chaos/db';
import { chaosApp } from './chaos/setup';
// src/index.ts cria o app ao ser importado; o chaos/setup.ts o guarda e anula o listen()
import './src/index';

export default {
  /** Monta o app SEM abrir porta: o app que src/index.ts cria (express() na linha 9), guardado pelo chaos/setup.ts. */
  createApp: () => chaosApp(),
  /** Carregados antes de cada teste gerado: o Prisma do app fala com o PGlite de chaos/db.ts (pela URL do banco), e o express guarda o app. */
  setupFiles: ['chaos/setup.ts'],
  /** Estado limpo antes de cada teste: o banco vazio (e os dados que as requisições abaixo usam, no chaos/db.ts). */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */
  invariants: {
    // ex.: async estoqueNuncaNegativo() { return (await menorEstoque()) >= 0; },
  },
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    // nenhuma API externa nas rotas sensíveis
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'DELETE /post/:id': { path: '/post/1' }, // (src/index.ts:84)
    'GET /feed': { path: '/feed' }, // pronta (src/index.ts:121)
    'GET /post/:id': { path: '/post/1' }, // (src/index.ts:112)
    'GET /user/:id/drafts': { path: '/user/1/drafts' }, // (src/index.ts:99)
    'GET /users': { path: '/users' }, // pronta (src/index.ts:94)
    'POST /post': { path: '/post', body: { authorEmail: 'teste@exemplo.com', content: 'teste', title: 'teste' } }, // corpo pelos campos que <inline> lê (confira os valores) (src/index.ts:32)
    'POST /signup': { path: '/signup', body: { email: 'novo@exemplo.com', name: 'teste', posts: [] } }, // e-mail diferente do usuário do chaos/db.ts (src/index.ts:13)
    'PUT /post/:id/views': { path: '/post/1/views', body: {} }, // sem corpo: os handlers do projeto não leem req.body (src/index.ts:44)
    'PUT /publish/:id': { path: '/publish/1', body: {} }, // sem corpo: os handlers do projeto não leem req.body (src/index.ts:63)
  },
};
