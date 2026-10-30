import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  attackSurface,
  buildSystemGraph,
  buildTopology,
  CHAOS_CONFIG_TODO,
  chaosConfigPending,
  chaosConfigScaffold,
  chaosDbPlan,
  chaosDbScaffold,
  chaosSetupScaffold,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  readChaosConfig,
  schemaFilesOf,
  silentHost,
  TsParser,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { runChaosPipeline } from '../../src/chaos';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));

async function scaffoldOf(example: string) {
  const dir = path.join(EXAMPLES, example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const surface = attackSurface(buildTopology(graph, buildSystemGraph(graph, [], dir), dir));
  const source = chaosConfigScaffold(surface);
  const parser = await TsParser.load(defaultWasmDir());
  return { surface, source, parser };
}

describe('R3 — contrato inicial gerado a partir do mapa', () => {
  it('o checkout-express sai com uma requisição por rota sensível e a API do Stripe, sem erro de sintaxe', async () => {
    const { surface, source, parser } = await scaffoldOf('checkout-express');
    expect(parser.withTree(source, false, (root) => root.hasError)).toBe(false);
    const facts = parser.withTree(source, false, readChaosConfig);
    expect(facts).toEqual({
      createApp: true,
      reset: true,
      invariants: [],
      requests: surface.routes.map((r) => r.id).sort(),
      apis: ['api.stripe.com'],
      setupFiles: [],
    });
    // o parâmetro do Express vira um valor de exemplo; o corpo do POST fica para o projeto
    expect(source).toContain("'GET /orders/:id': { path: '/orders/1' }");
    expect(source).toContain("'POST /checkout': { path: '/checkout', body: {} }");
    expect(source).toContain(`createApp no shieldepy.chaos.config.ts`);
    // uma marca por pendência: createApp, reset, a API do Stripe, o corpo do POST e o :id do GET
    expect(chaosConfigPending(source)).toBe(5);
    expect(source.split('\n').filter((l) => l.includes(CHAOS_CONFIG_TODO)).every((l) => !l.trimStart().startsWith('// Complete'))).toBe(true);
    // o contrato do exemplo, já preenchido, não tem pendência
    expect(chaosConfigPending(fs.readFileSync(path.join(EXAMPLES, 'checkout-express', 'shieldepy.chaos.config.ts'), 'utf8'))).toBe(0);
  });

  it('com o contrato gerado, o pipeline não reclama de rota nem de API faltando', async () => {
    const { surface, source, parser } = await scaffoldOf('checkout-express');
    const config = parser.withTree(source, false, readChaosConfig)!;
    const state = await runChaosPipeline(surface, { invariantNames: config.invariants, render: { config } });
    expect(state.specs.length).toBeGreaterThan(0);
    expect(state.warnings.filter((w) => /falta (requests|apis)|sem (createApp|reset)/.test(w))).toEqual([]);
  });

  it('C2d: com o pg no mapa, o contrato já sai com o banco de teste no setupFiles e no reset', async () => {
    const { surface, parser } = await scaffoldOf('checkout-express');
    const plan = chaosDbPlan(surface, ['db/migrations/002_orders.sql', 'db/migrations/001_stock.sql', 'db/seed.sql'])!;
    expect(plan).toEqual({ driver: 'pg', schemaFiles: ['db/migrations/001_stock.sql', 'db/migrations/002_orders.sql'], tables: ['orders', 'stock'] });
    const source = chaosConfigScaffold(surface, { db: plan });
    expect(parser.withTree(source, false, (root) => root.hasError)).toBe(false);
    expect(parser.withTree(source, false, readChaosConfig)).toMatchObject({ createApp: true, reset: true, setupFiles: ['chaos/setup.ts'] });
    expect(source).toContain("import { resetDb } from './chaos/db';");
    // o reset deixou de ser pendência: createApp, a API do Stripe, o corpo do POST e o :id do GET
    expect(chaosConfigPending(source)).toBe(4);
    const files = { ...chaosDbScaffold(plan), 'chaos/setup.ts': chaosSetupScaffold({ db: plan })! };
    for (const [file, text] of Object.entries(files)) {
      if (file.endsWith('.ts')) expect(parser.withTree(text, false, (root) => root.hasError), file).toBe(false);
    }
    expect(Object.keys(chaosDbScaffold(plan)).sort()).toEqual(['chaos/db.ts']);
    // o setup troca só o pg: sem app guardado, não há troca do express
    expect(files['chaos/setup.ts']).toContain("vi.mock('pg'");
    expect(files['chaos/setup.ts']).not.toContain("vi.mock('express'");
  });

  it('C2d: sem .sql no projeto, o esquema vira uma pendência e o chaos/schema.sql lista as tabelas do mapa', async () => {
    const { surface } = await scaffoldOf('checkout-express');
    const plan = chaosDbPlan(surface, [])!;
    const source = chaosConfigScaffold(surface, { db: plan });
    expect(chaosConfigPending(source)).toBe(5);
    expect(source).toMatch(/TODO\(shieldepy\): o projeto não tem \.sql de esquema/);
    const files = chaosDbScaffold(plan);
    expect(files['chaos/schema.sql']).toContain('orders, stock');
    expect(files['chaos/db.ts']).toContain("const SCHEMA = ['chaos/schema.sql'];");
  });

  it('C2d: sem pg no mapa (Prisma, Mongoose, nenhum banco), não há banco gerado', () => {
    expect(chaosDbPlan({ version: 1, topologyHash: 'x', routes: [], collisions: [] }, ['schema.sql'])).toBeUndefined();
    expect(schemaFilesOf(['b.sql', 'a.sql', 'src\\x.ts', 'chaos/schema.sql'])).toEqual(['a.sql', 'b.sql']);
  });

  it('sem rota sensível, o contrato diz que não há o que testar', () => {
    const source = chaosConfigScaffold({ version: 1, topologyHash: 'x', routes: [], collisions: [] });
    expect(source).toContain('nenhuma rota sensível no mapa');
    expect(source).toContain('nenhuma API externa');
  });
});
