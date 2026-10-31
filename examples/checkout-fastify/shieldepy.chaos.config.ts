// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Os testes de caos saem da topologia, mas só o projeto sabe: como subir o app sem abrir porta,
// como zerar o estado, o que nunca pode acontecer e como é uma requisição válida de cada rota.
// Complete as linhas marcadas abaixo (uma marca por pendência) e rode "ShielDepy: Testar Caos"
// (ou `shieldepy chaos .`). As invariantes são opcionais, mas são elas que provam corrida e estado.

import { minStock, orderCount, resetDb } from './chaos/db';
import type { IncomingMessage, ServerResponse } from 'node:http';
// o app do projeto (Fastify() em src/app.ts:6)
import { buildApp as projectApp } from './src/app';

// o Fastify só atende depois do ready(): o supertest recebe um handler que espera por ele
type FastifyLike = { ready(): PromiseLike<unknown>; routing(req: unknown, res: unknown): void };
const fastifyHandler = (app: FastifyLike) => (req: IncomingMessage, res: ServerResponse) => {
  app.ready().then(
    () => app.routing(req, res),
    (err) => {
      res.statusCode = 500;
      res.end(String(err));
    }
  );
};

export default {
  /** Monta o app SEM abrir porta (os testes usam supertest): a fábrica `buildApp` de src/app.ts. */
  createApp: () => fastifyHandler(projectApp()),
  /** Carregados antes de cada teste gerado: o `pg` do app vira o PGlite de chaos/db.ts (esquema em chaos/schema.sql). */
  setupFiles: ['chaos/setup.ts'],
  /** Estado limpo antes de cada teste: o banco vazio e um único item em estoque (no chaos/db.ts). */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */
  invariants: {
    /** Nunca vender o que não tem. */
    async stockNeverNegative(): Promise<boolean> {
      return (await minStock()) >= 0;
    },
    /** Com 1 item em estoque, no máximo 1 pedido. */
    async atMostOneOrder(): Promise<boolean> {
      return (await orderCount()) <= 1;
    },
    /** Nenhum cliente cobrado sem pedido: cobranças no Stripe, menos estornos, nunca passam dos pedidos. */
    async noChargeWithoutOrder(ctx?: { apiCalls: { host: string; method: string; path: string }[] }): Promise<boolean> {
      if (!ctx) return true;
      const stripe = (path: string) => ctx.apiCalls.filter((c) => c.host === 'api.stripe.com' && c.method === 'POST' && c.path === path).length;
      return stripe('/v1/charges') - stripe('/v1/refunds') <= (await orderCount());
    },
  },
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    'api.stripe.com': () => ({ id: 'ch_test', status: 'succeeded' }),
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'POST /api/checkout': { path: '/api/checkout', body: { productId: 'p-1', quantity: 1, priceCents: 1990, cardToken: 'tok_visa' } },
  },
};
