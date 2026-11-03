// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Saiu do `--init`; à mão: os registros do chaos/db.ts, a chave de ingestão e o corpo do erro.
// Só o POST /ingest/error: é a rota do par real (o commit 369bba2 corrige a corrida dela).

import { resetDb, INGEST_KEY } from './chaos/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
// o app do projeto (Fastify() em src/app.ts:33)
import { createApp as projectApp } from './src/app';

// o Fastify só atende depois do ready(): o supertest recebe um handler que espera por ele
type FastifyLike = { ready(): PromiseLike<unknown>; routing(req: unknown, res: unknown): void };
const fastifyHandler = (app: FastifyLike | Promise<FastifyLike>) => (req: IncomingMessage, res: ServerResponse) => {
  // a fábrica do projeto pode ser async (`export async function createApp()`)
  Promise.resolve(app)
    .then((instance) => instance.ready().then(() => instance.routing(req, res)))
    .catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
};

export default {
  /** Monta o app SEM abrir porta (os testes usam supertest): a fábrica `createApp` de src/app.ts. */
  createApp: () => fastifyHandler(projectApp()),
  /** Carregados antes de cada teste gerado: o Prisma do app fala com o PGlite de chaos/db.ts (pela URL do banco). */
  setupFiles: ['chaos/setup.ts'],
  /** Estado limpo antes de cada teste: o banco com a organização, o projeto e a chave do chaos/db.ts. */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer. Aqui o banco já garante a unicidade: o que quebra é a resposta (500). */
  invariants: {},
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    'api.resend.com': () => ({ id: 'email-1' }),
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'POST /ingest/error': {
      path: '/ingest/error',
      headers: { Authorization: `Bearer ${INGEST_KEY}` },
      body: { app: 'web', message: 'TypeError: x is undefined', stack: 'TypeError: x is undefined\n    at main (app.js:1:1)' },
    },
  },
};
