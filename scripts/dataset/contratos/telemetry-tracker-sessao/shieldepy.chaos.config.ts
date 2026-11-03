// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Saiu do `--init`; à mão: os registros do chaos/db.ts, a chave de ingestão, o corpo da sessão e a invariante.
// Só o POST /ingest/session: é a rota do par real (o commit 4639cc5 corrige a corrida dela). A corrida aqui
// não dá 500: duas requisições iguais gravam duas linhas, e só a invariante enxerga.

import { db, resetDb, INGEST_KEY } from './chaos/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
// o app do projeto (Fastify() em src/app.ts)
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
  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */
  invariants: {
    /** A mesma sessão do mesmo app é uma linha só (a chave que o commit passa a garantir). */
    async sessaoUnica(): Promise<boolean> {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT 1 FROM "Session" GROUP BY project_id, session_id, app HAVING count(*) > 1) repetidas`);
      return rows[0]!.n === 0;
    },
  },
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    'api.resend.com': () => ({ id: 'email-1' }),
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'POST /ingest/session': {
      path: '/ingest/session',
      headers: { Authorization: `Bearer ${INGEST_KEY}` },
      body: { app: 'web', session_id: 'sessao-1' },
    },
  },
};
