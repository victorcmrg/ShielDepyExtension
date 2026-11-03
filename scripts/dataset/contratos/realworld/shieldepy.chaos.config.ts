// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Saiu do `--init`; à mão: os registros do chaos/db.ts, o JWT (o --init ainda não gera) e os parâmetros.
// O token é assinado com o segredo padrão do src/app/routes/auth/auth.ts, para o usuário 1 do chaos/db.ts.

import jwt from 'jsonwebtoken';
import { resetDb } from './chaos/db';
import { chaosApp } from './chaos/setup';
// src/main.ts cria o app ao ser importado; o chaos/setup.ts o guarda e anula o listen()
import './src/main';

const headers = { Authorization: `Token ${jwt.sign({ user: { id: 1 } }, 'superSecret')}` };

export default {
  /** Monta o app SEM abrir porta: o app que src/main.ts cria (express() na linha 7), guardado pelo chaos/setup.ts. */
  createApp: () => chaosApp(),
  /** Carregados antes de cada teste gerado: o Prisma do app fala com o PGlite de chaos/db.ts (pela URL do banco), e o express guarda o app. */
  setupFiles: ['chaos/setup.ts'],
  /** Estado limpo antes de cada teste: o banco com os registros do chaos/db.ts. */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer. Aqui o banco já garante a unicidade: o que quebra é a resposta (500). */
  invariants: {},
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    // nenhuma API externa nas rotas sensíveis
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'DELETE /api/articles/:slug': { path: '/api/articles/artigo-1', headers },
    'DELETE /api/articles/:slug/comments/:id': { path: '/api/articles/artigo-1/comments/1', headers },
    'DELETE /api/articles/:slug/favorite': { path: '/api/articles/artigo-1/favorite', headers },
    'DELETE /api/profiles/:username/follow': { path: '/api/profiles/bia/follow', headers },
    'GET /api/articles': { path: '/api/articles' },
    'GET /api/articles/:slug': { path: '/api/articles/artigo-1' },
    'GET /api/articles/:slug/comments': { path: '/api/articles/artigo-1/comments' },
    'GET /api/articles/feed': { path: '/api/articles/feed', headers },
    'GET /api/profiles/:username': { path: '/api/profiles/bia' },
    'GET /api/tags': { path: '/api/tags' },
    'GET /api/user': { path: '/api/user', headers },
    'POST /api/articles': { path: '/api/articles', headers, body: { article: { body: 'teste', description: 'teste', tagList: [], title: 'Novo artigo' } } },
    'POST /api/articles/:slug/comments': { path: '/api/articles/artigo-1/comments', headers, body: { comment: { body: 'teste' } } },
    'POST /api/articles/:slug/favorite': { path: '/api/articles/artigo-1/favorite', headers, body: {} },
    'POST /api/profiles/:username/follow': { path: '/api/profiles/bia/follow', headers, body: {} },
    'POST /api/users': { path: '/api/users', body: { user: { email: 'novo@exemplo.com', password: 'Senha-forte-123', username: 'novo' } } },
    'POST /api/users/login': { path: '/api/users/login', body: { user: { email: 'ana@exemplo.com', password: 'Senha-forte-123' } } },
    'PUT /api/articles/:slug': { path: '/api/articles/artigo-1', headers, body: { article: { body: 'novo texto', description: 'nova descricao' } } },
    'PUT /api/user': { path: '/api/user', headers, body: { user: { bio: 'teste' } } },
  },
};
