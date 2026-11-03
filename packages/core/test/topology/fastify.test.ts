import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, buildTopology, findExpressRoutes, indexFiles, listSourceFiles, silentHost, type CodeGraph, type Route } from '../../src/index';
import { createGraph, Fixture, indexFile, REPO_ROOT, symbolId } from '../helpers';

/** `GET /x: a → b` — a cadeia de handlers numa linha, pra comparar fácil. */
const show = (r: Route) => `${r.id}: ${r.handlers.map((h) => h.label).join(' → ')}`;

describe('MVP4 — rotas Fastify pela instância do pacote', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('verbos na instância de Fastify(), com opções no meio; `.post` de outra coisa não é rota', () => {
    const f = indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import Fastify from 'fastify';",
        'class Mailer { post(to: string, body: string) {} }',
        'async function create() {}',
        'async function auth() {}',
        'export function buildApp() {',
        '  const app = Fastify({ logger: false });',
        "  app.post('/orders', create);",
        "  app.get('/orders/:id', { preHandler: [auth], schema: { params: {} } }, create);",
        "  app.get('/health', async () => ({ ok: true }));",
        "  app.get('/env');",
        "  new Mailer().post('/not-a-route', 'x');",
        '  return app;',
        '}',
      ].join('\n')
    );
    const { routes } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual(['GET /health: <inline>', 'POST /orders: create', 'GET /orders/:id: auth → create']);
    expect(routes.find((r) => r.id === 'POST /orders')).toMatchObject({ file: f, line: 6 });
    expect(routes.find((r) => r.id === 'POST /orders')!.handlers[0]!.symbols).toEqual([symbolId(graph, 'create', f)]);
    expect(routes.find((r) => r.id === 'GET /orders/:id')!.handlers[0]!.middleware).toBe(true);
  });

  it('plugins registrados com prefixo, tipados ou não, aninhados; route({ method, url, handler })', () => {
    indexFile(graph, fx, 'handlers.ts', 'export async function checkout() {}\nexport async function list() {}\nexport async function remove() {}\n');
    indexFile(
      graph,
      fx,
      'routes/orders.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        "import { checkout, list, remove } from '../handlers';",
        'export async function orderRoutes(app: FastifyInstance) {',
        "  app.post('/checkout', checkout);",
        "  app.route({ method: ['GET', 'HEAD'], url: '/orders', handler: list });",
        "  app.register(adminRoutes, { prefix: '/admin' });",
        '}',
        // sem tipo: só vale porque orderRoutes o registra
        'async function adminRoutes(admin) {',
        "  admin.route({ method: 'DELETE', url: '/orders/:id', async handler(req, reply) { return remove(); } });",
        '}',
        // sem tipo e sem ninguém registrar: o parâmetro pode ser qualquer coisa
        "export function notAPlugin(x) { x.post('/nope', checkout); }",
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import Fastify from 'fastify';",
        "import { orderRoutes } from './routes/orders';",
        'export function buildApp() {',
        '  const app = Fastify();',
        "  app.register(orderRoutes, { prefix: '/api' });",
        "  app.register(async (v2) => { v2.get('/ping', async () => 'pong'); }, { prefix: '/v2' });",
        '  return app;',
        '}',
      ].join('\n')
    );
    expect(findExpressRoutes(graph).routes.map(show)).toEqual([
      'DELETE /api/admin/orders/:id: <inline>',
      'POST /api/checkout: checkout',
      'GET /api/orders: list',
      'HEAD /api/orders: list',
      'GET /v2/ping: <inline>',
    ]);
  });

  it('addHook antes da rota entra na cadeia (e nos plugins registrados depois); o caminho não literal é pulado', () => {
    indexFile(
      graph,
      fx,
      'app.js',
      [
        "const Fastify = require('fastify');",
        'async function auth() {}',
        'async function create() {}',
        'const app = Fastify();',
        "app.get('/open', create);",
        "app.addHook('preHandler', auth);",
        "app.addHook('onSend', auth);",
        "app.post('/orders', create);",
        "app.register(async (child) => { child.put('/orders/:id', create); });",
        'const dyn = "/x";',
        'app.post(dyn, create);',
        "app.route({ method: verb, url: '/y', handler: create });",
        'app.listen({ port: 3000 });',
      ].join('\n')
    );
    const scan = findExpressRoutes(graph);
    expect(scan.routes.map(show)).toEqual(['GET /open: create', 'POST /orders: auth → create', 'PUT /orders/:id: auth → create']);
    expect(scan.skipped.map((s) => s.reason)).toEqual(['POST: caminho não literal', 'route(): método ou caminho não literal']);
  });
});

describe('Rotas em função de plugin: as operações do callback e do serviço', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const ops = (id: string) => {
    const topology = buildTopology(graph, buildSystemGraph(graph, [], fx.dir), fx.dir);
    return topology.routes.find((r) => r.id === id)?.operations.map((o) => `${o.kind} ${o.target} ${o.confidence}`);
  };

  /** O serviço recebe o cliente por parâmetro tipado, em outro arquivo. */
  const service = () =>
    indexFile(
      graph,
      fx,
      'services/groups.ts',
      [
        "import type { PrismaClient } from '@prisma/client';",
        'export async function findOrCreateGroup(prisma: PrismaClient, fingerprint: string) {',
        '  const existing = await prisma.group.findUnique({ where: { fingerprint } });',
        '  if (existing) return existing;',
        '  return prisma.group.create({ data: { fingerprint } });',
        '}',
      ].join('\n')
    );

  // hoje dá zero operações: o callback dentro de função não vira símbolo (a tarefa seguinte tira o `.fails`)
  it.fails('o callback escrito na função acha a chamada direta e a do serviço (telemetry-tracker em miniatura)', () => {
    service();
    indexFile(
      graph,
      fx,
      'routes/ingest.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        "import type { PrismaClient } from '@prisma/client';",
        "import { findOrCreateGroup } from '../services/groups';",
        'export async function ingestRoutes(app: FastifyInstance, prisma: PrismaClient) {',
        "  app.post('/error', async (request, reply) => {",
        '    await prisma.event.create({ data: {} });',
        "    const group = await findOrCreateGroup(prisma, 'x');",
        '    return reply.send(group);',
        '  });',
        '}',
      ].join('\n')
    );
    expect(ops('POST /error')).toEqual(['db_write event proven', 'db_read group proven', 'db_write group proven']);
  });

  it('com o handler por nome, o `prisma` tipado por parâmetro já chegava às operações', () => {
    service();
    indexFile(
      graph,
      fx,
      'routes/ingest.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        "import type { PrismaClient } from '@prisma/client';",
        "import { findOrCreateGroup } from '../services/groups';",
        'async function handle(request: unknown, prisma: PrismaClient) {',
        '  await prisma.event.create({ data: {} });',
        "  return findOrCreateGroup(prisma, 'x');",
        '}',
        'export async function ingestRoutes(app: FastifyInstance) {',
        "  app.post('/error', handle);",
        '}',
      ].join('\n')
    );
    expect(ops('POST /error')).toEqual(['db_write event proven', 'db_read group proven', 'db_write group proven']);
  });
});

describe('MVP4 — os exemplos checkout-fastify: a topologia com as operações em ordem', () => {
  for (const [name, ops] of [
    // lê o estoque, cobra (sem timeout) e só depois grava: a janela da corrida
    ['checkout-fastify', ['db_read stock', 'api_call api.stripe.com', 'db_write stock', 'db_write orders']],
    // reserva antes de cobrar, devolve a reserva se a cobrança falhar, estorna se o pedido não grava
    ['checkout-fastify-fixed', ['db_write stock', 'api_call api.stripe.com', 'db_write stock', 'db_write orders', 'api_call api.stripe.com', 'db_write stock']],
  ] as const) {
    it(`${name}: POST /api/checkout com o preHandler, as operações e as tags, tudo provado`, async () => {
      const graph = await createGraph();
      const root = path.join(REPO_ROOT, 'examples', name);
      await indexFiles(graph, await listSourceFiles(root), silentHost);
      const topology = buildTopology(graph, buildSystemGraph(graph, [], root), root);
      expect(topology.routes.map((r) => r.id)).toEqual(['POST /api/checkout', 'GET /api/orders/:id']);
      const checkout = topology.routes[0]!;
      expect(checkout.handlers.map((h) => h.label)).toEqual(['validateCheckout', 'checkoutController.create']);
      expect(checkout.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(ops);
      expect(checkout.confidence).toBe('proven');
      if (name === 'checkout-fastify') {
        expect(checkout.tags.map((t) => t.tag)).toEqual(['external-io', 'no-timeout', 'no-transaction', 'read-then-write', 'write-after-api-call']);
      } else expect(checkout.tags.map((t) => t.tag)).not.toContain('no-timeout');
    });
  }
});
