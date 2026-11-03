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

  it('o callback escrito na função acha a chamada direta e a do serviço (telemetry-tracker em miniatura)', () => {
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

  const plugin = (...body: string[]) =>
    indexFile(
      graph,
      fx,
      'routes/plugin.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        "import { PrismaClient } from '@prisma/client';",
        'const prisma = new PrismaClient();',
        'const wrap = (fn: unknown) => fn;',
        'const cache = { get(key: string, load: () => unknown) { return load(); } };',
        'export async function routes(app: FastifyInstance) {',
        ...body,
        '}',
      ].join('\n')
    );

  it('o handler escrito em route({...}), o embrulhado e o hook escrito na hora entram na cadeia', () => {
    plugin(
      "  app.route({ method: 'GET', url: '/a', handler: async () => prisma.a.findMany() });",
      "  app.get('/b', wrap(async () => prisma.b.findMany()));",
      "  app.get('/c', { preHandler: async () => { await prisma.hook.findMany(); } }, async () => prisma.c.findMany());"
    );
    expect(ops('GET /a')).toEqual(['db_read a proven']);
    expect(ops('GET /b')).toEqual(['db_read b proven']);
    expect(ops('GET /c')).toEqual(['db_read hook proven', 'db_read c proven']);
  });

  it('o callback que não é de rota continua no lugar dele: dentro do handler, na ordem, e em `.map`', () => {
    plugin(
      "  app.post('/x', async () => {",
      '    await prisma.first.findMany();',
      "    await cache.get('k', async () => prisma.second.findMany());",
      '    await Promise.all([1].map(async () => prisma.third.create({ data: {} })));',
      '    await prisma.last.create({ data: {} });',
      '  });'
    );
    expect(ops('POST /x')).toEqual(['db_read first proven', 'db_read second proven', 'db_write third proven', 'db_write last proven']);
  });

  it('o id do callback é estável: inserir código acima não muda, e a topologia não depende da ordem de indexação', async () => {
    const files: Array<[string, string]> = [
      ['b/service.ts', "import type { PrismaClient } from '@prisma/client';\nexport const save = (prisma: PrismaClient) => prisma.order.create({ data: {} });\n"],
      [
        'a/plugin.ts',
        [
          "import type { FastifyInstance } from 'fastify';",
          "import type { PrismaClient } from '@prisma/client';",
          "import { save } from '../b/service';",
          'export async function routes(app: FastifyInstance, prisma: PrismaClient) {',
          "  app.post('/one', async () => save(prisma));",
          "  app.post('/two', async () => save(prisma));",
          '}',
        ].join('\n'),
      ],
    ];
    const topologyOf = async (order: Array<[string, string]>) => {
      const g = await createGraph();
      for (const [name, text] of order) indexFile(g, fx, name, text);
      return buildTopology(g, buildSystemGraph(g, [], fx.dir), fx.dir);
    };
    const direct = await topologyOf(files);
    expect(direct.stats.operations).toBe(2);
    expect((await topologyOf([...files].reverse())).contentHash).toBe(direct.contentHash);

    const moved = await topologyOf([files[0]!, [files[1]![0], `// um comentário\n\n${files[1]![1]}`]]);
    expect(moved.routes.map((r) => r.handlers[0]!.symbols)).toEqual(direct.routes.map((r) => r.handlers[0]!.symbols));
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
