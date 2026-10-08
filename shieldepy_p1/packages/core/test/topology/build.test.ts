import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildSystemGraph,
  buildTopology,
  indexFiles,
  listSourceFiles,
  sensitivityTags,
  silentHost,
  type CodeGraph,
  type IoOperation,
  type Rule,
  type TopologyGraph,
  type TopologyRoute,
} from '../../src/index';
import { createGraph, Fixture, indexFile, REPO_ROOT } from '../helpers';

const op = (kind: IoOperation['kind'], target: string, extra: Partial<IoOperation> = {}) => ({ kind, target, ...extra });
const tagNames = (r: TopologyRoute) => r.tags.map((t) => (t.targets ? `${t.tag}(${t.targets.join(',')})` : t.tag));

describe('E2/2d — tags de sensibilidade', () => {
  it('read-then-write sem proteção, write-after-api-call e no-timeout', () => {
    const tags = sensitivityTags([
      op('db_read', 'stock'),
      op('api_call', 'api.stripe.com', { timeout: 'no' }),
      op('db_write', 'stock'),
      op('db_write', 'orders'),
    ]);
    expect(tags).toEqual([
      { tag: 'external-io', targets: ['api.stripe.com'] },
      { tag: 'no-timeout', targets: ['api.stripe.com'] },
      { tag: 'no-transaction', targets: ['stock'] },
      { tag: 'read-then-write', targets: ['stock'] },
      { tag: 'write-after-api-call', targets: ['orders', 'stock'] },
    ]);
  });

  it('FOR UPDATE ou leitura dentro de BEGIN tiram o no-transaction, mas o read-then-write fica', () => {
    const lock = sensitivityTags([op('db_read', 'stock', { lock: true }), op('db_write', 'stock')]);
    expect(lock.map((t) => t.tag)).toEqual(['read-then-write']);
    const tx = sensitivityTags([op('db_tx', 'transaction', { operation: 'BEGIN' }), op('db_read', 'stock'), op('db_write', 'stock'), op('db_tx', 'transaction', { operation: 'COMMIT' })]);
    expect(tx.map((t) => t.tag)).toEqual(['read-then-write']);
    // a leitura veio ANTES do BEGIN: a janela de corrida continua aberta
    const late = sensitivityTags([op('db_read', 'stock'), op('db_tx', 'transaction', { operation: 'BEGIN' }), op('db_write', 'stock')]);
    expect(late.map((t) => t.tag)).toEqual(['no-transaction', 'read-then-write']);
  });

  it('escrita repetida, timeout presente/desconhecido e alvo dinâmico', () => {
    const tags = sensitivityTags([
      op('api_call', 'a.io', { timeout: 'yes' }),
      op('api_call', 'b.io', { timeout: 'unknown' }),
      op('db_read', 'dynamic'),
      op('db_write', 'dynamic'),
      op('db_write', 'audit'),
      op('db_write', 'audit'),
    ]);
    expect(tags).toEqual([
      { tag: 'external-io', targets: ['a.io', 'b.io'] },
      { tag: 'multi-write-same-target', targets: ['audit'] },
      { tag: 'write-after-api-call', targets: ['audit', 'dynamic'] },
    ]);
  });
});

describe('E2/2d — topologia', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const topology = (rules: Rule[] = []): TopologyGraph => buildTopology(graph, buildSystemGraph(graph, rules, fx.dir), fx.dir);

  it('aceitação: checkout-express', async () => {
    const dir = path.join(REPO_ROOT, 'examples/checkout-express');
    await indexFiles(graph, await listSourceFiles(dir), silentHost);
    const t = buildTopology(graph, buildSystemGraph(graph, [], dir), dir);

    const checkout = t.routes.find((r) => r.id === 'POST /checkout')!;
    expect(checkout.handlers.map((h) => h.label)).toEqual(['express.json()', 'validateCheckout', 'checkoutController.create']);
    expect(checkout.operations.map((o) => `${o.order} ${o.kind} ${o.target} ${o.through.at(-1)}`)).toEqual([
      '1 db_read stock src/repositories/StockRepository.ts#available:5',
      '2 api_call api.stripe.com src/gateways/StripeGateway.ts#charge:6',
      '3 db_write stock src/repositories/StockRepository.ts#decrement:10',
      '4 db_write orders src/repositories/OrderRepository.ts#insert:12',
    ]);
    expect(checkout.operations[1]).toMatchObject({ via: 'fetch', timeout: 'no', file: 'src/gateways/StripeGateway.ts', line: 7 });
    expect(checkout.operations[1]!.through).toEqual([
      'src/controllers/CheckoutController.ts#create:7',
      'src/services/CheckoutService.ts#checkout:23',
      'src/gateways/StripeGateway.ts#charge:6',
    ]);
    expect(tagNames(checkout)).toEqual([
      'external-io(api.stripe.com)',
      'no-timeout(api.stripe.com)',
      'no-transaction(stock)',
      'read-then-write(stock)',
      'write-after-api-call(orders,stock)',
    ]);
    expect(checkout.confidence).toBe('proven');

    const order = t.routes.find((r) => r.id === 'GET /orders/:id')!;
    expect(order.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(['db_read orders']);
    expect(order.tags).toEqual([]);
    expect(t.stats).toMatchObject({ routes: 2, sensitiveRoutes: 2, operations: 5, callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('checkout-express-fixed: reservar antes de cobrar e timeout tiram as tags de corrida e de timeout', async () => {
    const dir = path.join(REPO_ROOT, 'examples/checkout-express-fixed');
    await indexFiles(graph, await listSourceFiles(dir), silentHost);
    const t = buildTopology(graph, buildSystemGraph(graph, [], dir), dir);
    const checkout = t.routes.find((r) => r.id === 'POST /checkout')!;
    expect(checkout.operations.map((o) => `${o.kind} ${o.target} ${o.through.at(-1)!.split('#')[1]!.split(':')[0]}`)).toEqual([
      'db_write stock reserve',
      'api_call api.stripe.com charge',
      'db_write stock release',
      'db_write orders insert',
    ]);
    expect(checkout.operations[1]).toMatchObject({ timeout: 'yes' });
    // sobram só as tags verdadeiras: a compensação escreve de novo no estoque, depois da API
    expect(tagNames(checkout)).toEqual(['external-io(api.stripe.com)', 'multi-write-same-target(stock)', 'write-after-api-call(orders,stock)']);
    expect(t.stats).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('determinística: mesma entrada em outra ordem de indexação → mesmo hash', async () => {
    const files = {
      'app.ts': "import express from 'express';\nimport { save } from './repo';\nconst app = express();\napp.post('/x', async () => { await save(); });\n",
      'repo.ts': "import { Pool } from 'pg';\nconst pool = new Pool();\nexport async function save() { await pool.query('INSERT INTO t VALUES (1)'); }\n",
    };
    for (const [p, c] of Object.entries(files)) indexFile(graph, fx, p, c);
    const first = topology();
    const other = await createGraph();
    for (const [p, c] of Object.entries(files).reverse()) other.updateFile(fx.path(p), c);
    const second = buildTopology(other, buildSystemGraph(other, [], fx.dir), fx.dir);
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.routes[0]!.operations.map((o) => `${o.kind} ${o.target}`)).toEqual(['db_write t']);
  });

  it('recursão não trava; chamada repetida conta duas vezes; ligação por nome marca heuristic', () => {
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        "import { Pool } from 'pg';",
        'const pool = new Pool();',
        "async function log() { await pool.query('INSERT INTO audit VALUES (1)'); }",
        'async function walk(n: number): Promise<void> { await log(); if (n > 0) await walk(n - 1); }',
        'class Repo { async touch() { await log(); } }',
        'async function viaGuess(r: any) { await r.touch(); }',
        'const app = express();',
        "app.post('/w', async () => { await walk(3); await log(); });",
        "app.post('/g', async () => { await viaGuess(null); });",
      ].join('\n')
    );
    const t = topology();
    const w = t.routes.find((r) => r.id === 'POST /w')!;
    expect(w.operations.map((o) => o.target)).toEqual(['audit', 'audit']);
    expect(tagNames(w)).toEqual(['multi-write-same-target(audit)']);
    expect(w.truncated).toBeUndefined();
    const g = t.routes.find((r) => r.id === 'POST /g')!;
    expect(g.operations).toMatchObject([{ target: 'audit', confidence: 'heuristic' }]);
    expect(g.confidence).toBe('heuristic');
  });

  it('colisão entre regras reativas cujo handler está no caminho da rota', () => {
    const f = fx.path('app.ts');
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        'function onOrderA() { }',
        'function onOrderB() { }',
        'function create() { onOrderA(); }',
        'const app = express();',
        "app.post('/orders', create);",
        "app.get('/health', () => {});",
      ].join('\n')
    );
    const rule = (id: string, line: number): Rule => ({
      id,
      name: id,
      resource: 'Order',
      event: 'created',
      reads: [],
      writes: ['total'],
      source: 'test',
      location: { file: f, line },
    });
    const t = topology([rule('A', 1), rule('B', 2)]);
    expect(t.collisions).toHaveLength(1);
    expect(t.collisions[0]).toMatchObject({ bucket: 'Order::created', routes: ['POST /orders'] });
    const orders = t.routes.find((r) => r.id === 'POST /orders')!;
    expect(orders.collisions).toEqual([t.collisions[0]!.key]);
    expect(orders.operations).toEqual([]);
    expect(t.stats.sensitiveRoutes).toBe(1);
  });
});
