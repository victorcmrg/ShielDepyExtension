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

describe('Plugins escritos no register dentro de uma função', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('com o mesmo nome de parâmetro, cada um fica com o seu prefixo: as rotas não se multiplicam (telemetry-tracker)', () => {
    indexFile(graph, fx, 'routes/inner.ts', "import type { FastifyInstance } from 'fastify';\nexport async function inner(app: FastifyInstance) { app.get('/in', async () => 1); }\n");
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import Fastify from 'fastify';",
        "import { inner } from './routes/inner';",
        'export async function createApp() {',
        '  const app = Fastify();',
        "  await app.register(async function publicSurface(f) { f.get('/', async () => 1); });",
        "  await app.register(async function ingestScope(f) { await f.register(inner); }, { prefix: '/ingest' });",
        "  await app.register(async (f) => { f.get('/ping', async () => 1); }, { prefix: '/api' });",
        // a instância de fora, capturada: a rota é dela, sem o prefixo do plugin de dentro
        "  await app.register(async () => { app.get('/direct', async () => 1); }, { prefix: '/nope' });",
        '  return app;',
        '}',
      ].join('\n')
    );
    expect(findExpressRoutes(graph).routes.map((r) => r.id)).toEqual(['GET /', 'GET /api/ping', 'GET /direct', 'GET /ingest/in']);
  });

  it('o app montado num arquivo de teste não define rota: nem cópia sem prefixo, nem app', () => {
    indexFile(graph, fx, 'routes/inner.ts', "import type { FastifyInstance } from 'fastify';\nexport async function inner(app: FastifyInstance) { app.get('/in', async () => 1); }\n");
    indexFile(graph, fx, 'app.ts', "import Fastify from 'fastify';\nimport { inner } from './routes/inner';\nexport const app = Fastify();\napp.register(inner, { prefix: '/api' });\n");
    const harness = "import Fastify from 'fastify';\nimport { inner } from '../routes/inner';\nconst app = Fastify();\napp.register(inner);\napp.get('/only-in-test', async () => 1);\n";
    for (const name of ['routes/inner.test.ts', 'routes/inner.spec.js', '__tests__/inner.ts']) indexFile(graph, fx, name, harness);
    const scan = findExpressRoutes(graph);
    expect(scan.routes.map((r) => r.id)).toEqual(['GET /api/in']);
    expect(scan.apps).toHaveLength(1);
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

  /** Uma rota que chama `svc` (do arquivo `svc.ts`) passando o cliente que `call` escolher. */
  const routeCalling = (imports: string, setup: string, call: string) =>
    indexFile(
      graph,
      fx,
      'routes/caller.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        "import { PrismaClient } from '@prisma/client';",
        "import { svc } from '../svc';",
        imports,
        setup,
        "export async function routes(app: FastifyInstance) { app.post('/x', async () => " + call + '); }',
      ].join('\n')
    );

  it('parâmetro em união de tipos do mesmo pacote, ou com null: é o cliente', () => {
    indexFile(
      graph,
      fx,
      'svc.ts',
      [
        "import type { Prisma, PrismaClient } from '@prisma/client';",
        'export async function svc(a: PrismaClient | Prisma.TransactionClient, b: PrismaClient | null, c: PrismaClient | Map<string, string>) {',
        '  await a.one.create({ data: {} });',
        '  await b.two.create({ data: {} });',
        '  await c.three.create({ data: {} });',
        '}',
      ].join('\n')
    );
    routeCalling('', 'const client = new PrismaClient();\ndeclare const other: unknown;', 'svc(client, client, other)');
    // o `c` pode não ser o cliente: a união cruza com um tipo que não é do pacote, e quem chama não prova
    expect(ops('POST /x')).toEqual(['db_write one proven', 'db_write two proven']);
  });

  it('parâmetro sem tipo que recebe o cliente de quem chama: provado, inclusive repassado e capturado por callback', () => {
    indexFile(graph, fx, 'lib/db.ts', "import { PrismaClient } from '@prisma/client';\nexport const client = new PrismaClient();\n");
    indexFile(
      graph,
      fx,
      'svc.ts',
      [
        'export async function svc(db) {',
        '  await db.first.create({ data: {} });',
        '  await deeper(db);',
        '}',
        'async function deeper(handle) { await handle.second.findMany(); }',
      ].join('\n')
    );
    routeCalling("import { client } from '../lib/db';", '', 'svc(client)');
    expect(ops('POST /x')).toEqual(['db_write first proven', 'db_read second proven']);

    indexFile(
      graph,
      fx,
      'routes/plugin.ts',
      [
        "import type { FastifyInstance } from 'fastify';",
        'export async function ingestRoutes(app: FastifyInstance, db) {',
        "  app.post('/y', async () => db.third.create({ data: {} }));",
        '}',
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import Fastify from 'fastify';",
        "import { client } from './lib/db';",
        "import { ingestRoutes } from './routes/plugin';",
        'export async function build() { const app = Fastify(); await ingestRoutes(app, client); return app; }',
      ].join('\n')
    );
    expect(ops('POST /y')).toEqual(['db_write third proven']);
  });

  it('o parâmetro de um callback sem símbolo não é o da função de fora, mesmo no mesmo índice', () => {
    indexFile(
      graph,
      fx,
      'svc.ts',
      [
        'export async function svc(db, items) {',
        '  await Promise.all(items.map((item) => item.create({ data: {} })));',
        '  await Promise.all(items.map((item) => other(item)));',
        '}',
        'async function other(thing) { await thing.save.create({ data: {} }); }',
      ].join('\n')
    );
    routeCalling('', 'const client = new PrismaClient();\ndeclare const list: unknown[];', 'svc(client, list)');
    expect(ops('POST /x')).toEqual([]);
  });

  it('nem todo chamador prova o cliente: sai `heuristic`; dois pacotes diferentes: não se escolhe', () => {
    indexFile(graph, fx, 'svc.ts', 'export async function svc(db) { await db.order.create({ data: {} }); }\n');
    routeCalling('', 'const client = new PrismaClient();\ndeclare const other: unknown;\nexport const again = () => svc(other);', 'svc(client)');
    expect(ops('POST /x')).toEqual(['db_write order heuristic']);
  });

  it('só o nome `prisma`, sem tipo nem chamador que prove: sai `heuristic`; outro nome não conta', () => {
    indexFile(graph, fx, 'svc.ts', 'export async function svc(prisma, other) {\n  await prisma.order.create({ data: {} });\n  await other.item.create({ data: {} });\n}\n');
    routeCalling('', 'declare const a: unknown;', 'svc(a, a)');
    expect(ops('POST /x')).toEqual(['db_write order heuristic']);
  });

  it('o nome `prisma` num projeto sem o pacote não é o Prisma', () => {
    indexFile(graph, fx, 'svc.ts', 'export async function svc(prisma) { await prisma.order.create({ data: {} }); }\n');
    indexFile(
      graph,
      fx,
      'routes/caller.ts',
      ["import type { FastifyInstance } from 'fastify';", "import { svc } from '../svc';", 'declare const a: unknown;', "export async function routes(app: FastifyInstance) { app.post('/x', async () => svc(a)); }"].join('\n')
    );
    expect(ops('POST /x')).toEqual([]);
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

describe('Rotas registradas num laço sobre uma lista literal', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const app = (body: string[]) =>
    ["import Fastify from 'fastify';", "async function create() {}", "async function list() {}", 'export const app = Fastify();', ...body].join('\n');

  it('o fastify-prisma: objeto de rotas, `Object.values` em outro arquivo, `for...of` no plugin', () => {
    indexFile(graph, fx, 'controllers/user.ts', 'export async function signup() {}\nexport async function getAllUsers() {}\n');
    indexFile(graph, fx, 'controllers/index.ts', "export * from './user';\n");
    indexFile(graph, fx, 'middleware/index.ts', 'export async function validateRequest() {}\n');
    const routesFile = indexFile(
      graph,
      fx,
      'routes/routes.ts',
      [
        "import { RouteOptions } from 'fastify';",
        "import * as controllers from '../controllers';",
        "import * as middleware from '../middleware';",
        'const routes: Record<string, RouteOptions> = {',
        "  healthCheck: { method: 'GET', url: '/health', handler: (_, res) => { res.status(200).send(); } },",
        "  signup: { method: 'POST', url: '/signup', handler: controllers.signup },",
        "  getAllUsers: { method: 'GET', url: '/user', preHandler: [middleware.validateRequest], handler: controllers.getAllUsers },",
        '};',
        'export const renderRoutes = Object.values(routes);',
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'routes/index.ts',
      [
        "import { FastifyInstance, FastifyPluginCallback } from 'fastify';",
        "import { renderRoutes } from './routes';",
        'export const router: FastifyPluginCallback = (fastify: FastifyInstance, opts, next) => {',
        '  for (let route of renderRoutes) {',
        '    fastify.route(route);',
        '  }',
        '  next();',
        '};',
      ].join('\n')
    );
    indexFile(graph, fx, 'app.ts', ["import { fastify } from 'fastify';", "import { router } from './routes/index';", 'const app = fastify();', 'app.register(router);', 'export { app };'].join('\n'));

    const { routes, skipped } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual(['GET /health: <inline>', 'POST /signup: controllers.signup', 'GET /user: middleware.validateRequest → controllers.getAllUsers']);
    expect(skipped).toEqual([]);
    // o handler escrito na lista é o símbolo do par, não uma rota sem corpo
    expect(routes[0]!.handlers[0]!.symbols).toHaveLength(1);
    expect(graph.nodeAttributes(routes[0]!.handlers[0]!.symbols[0]!)).toMatchObject({ name: 'handler', file: routesFile });
    expect(routes.find((r) => r.id === 'GET /user')!.handlers[0]!.middleware).toBe(true);
    expect(routes.find((r) => r.id === 'POST /signup')!.handlers[0]!.opaque).toBeUndefined();
  });

  it('`for...of` sobre `Object.values` direto, e `forEach` nele', () => {
    indexFile(
      graph,
      fx,
      'app.ts',
      app([
        "const routes = { a: { method: 'POST', url: '/a', handler: create } };",
        "const others = { b: { method: ['GET', 'HEAD'], url: '/b', handler: list } };",
        'for (const r of Object.values(routes)) app.route(r);',
        'Object.values(others).forEach((r) => app.route(r));',
      ])
    );
    expect(findExpressRoutes(graph).routes.map(show)).toEqual(['POST /a: create', 'GET /b: list', 'HEAD /b: list']);
  });

  it('o verbo com os campos do item', () => {
    indexFile(graph, fx, 'app.ts', app(["const routes = [{ url: '/a', handler: create }, { url: '/b', handler: list }];", 'for (const r of routes) app.post(r.url, r.handler);']));
    expect(findExpressRoutes(graph).routes.map(show)).toEqual(['POST /a: create', 'POST /b: list']);
  });

  it('o handler que a lista não sabe ler sai opaco, sem sumir', () => {
    indexFile(graph, fx, 'app.ts', app(["const routes = [{ method: 'POST', url: '/a', handler: wrap(create) }];", 'for (const r of routes) app.route(r);']));
    const [route] = findExpressRoutes(graph).routes;
    expect(route).toMatchObject({ id: 'POST /a' });
    expect(route!.handlers[0]!.opaque).toBe(true);
  });

  it('a lista que não é literal fica em `skipped`, sem inventar rota', () => {
    indexFile(graph, fx, 'app.ts', app(['function build() { return []; }', 'for (const r of build()) app.route(r);', 'for (const k in { a: 1 }) app.route(k);']));
    const { routes, skipped } = findExpressRoutes(graph);
    expect(routes).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(['route(): método ou caminho não literal', 'route(): método ou caminho não literal']);
  });

  it('a chamada na expressão do `for...of` não é do laço', () => {
    indexFile(graph, fx, 'app.ts', app(["const routes = [{ url: '/a', handler: create }];", "for (const r of (app.get('/fora', list), routes)) app.post(r.url, r.handler);"]));
    const { routes, skipped } = findExpressRoutes(graph);
    // a vírgula esconde a lista: o `POST` fica em `skipped`, e o `GET` sai uma vez só, fora do laço
    expect(routes.map(show)).toEqual(['GET /fora: list']);
    expect(skipped.map((s) => s.reason)).toEqual(['POST: caminho não literal']);
  });

  it('no Express, `for...of` monta os roteadores da lista como o `forEach`', () => {
    indexFile(graph, fx, 'orders.ts', ["import { Router } from 'express';", 'export const orders = Router();', "orders.get('/', async () => {});"].join('\n'));
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        "import { orders } from './orders';",
        'const app = express();',
        "const routes = [{ path: '/orders', route: orders }];",
        'for (const r of routes) app.use(r.path, r.route);',
      ].join('\n')
    );
    expect(findExpressRoutes(graph).routes.map((r) => r.id)).toEqual(['GET /orders']);
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
