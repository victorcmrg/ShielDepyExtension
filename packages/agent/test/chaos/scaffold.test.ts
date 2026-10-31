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
  prismaDatasourceEnv,
  prismaTokens,
  readChaosConfig,
  schemaFilesOf,
  silentHost,
  TsParser,
  type AttackSurface,
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

  it('C2d: sem pg nem Prisma no mapa (Mongoose, nenhum banco), não há banco gerado', () => {
    expect(chaosDbPlan({ version: 1, topologyHash: 'x', routes: [], collisions: [] }, ['schema.sql'])).toBeUndefined();
    expect(schemaFilesOf(['b.sql', 'a.sql', 'src\\x.ts', 'chaos/schema.sql'])).toEqual(['a.sql', 'b.sql']);
  });

  // uma rota que lê e grava pelo Prisma (como o POST /api/users do realworld da C1)
  const prismaSurface = (extra: object[] = []) =>
    ({
      version: 1,
      topologyHash: 'x',
      collisions: [],
      routes: [
        {
          id: 'POST /api/users',
          method: 'POST',
          path: '/api/users',
          at: 'src/auth.ts:14',
          operations: [
            { kind: 'db_read', target: 'user', via: 'prisma' },
            { kind: 'db_write', target: 'user', via: 'prisma' },
            ...extra,
          ],
        },
      ],
    }) as unknown as AttackSurface;
  const SCHEMA = 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\nmodel User {\n  id Int @id\n}\n';

  it('C2d2: com o Prisma no mapa, o esquema sai das migrations ao lado do schema.prisma, e o reset já vem pronto', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const files = [
      'src/prisma/migrations/20211001_tags/migration.sql',
      'src/prisma/migrations/20210924_initial/migration.sql',
      'src/prisma/migrations/migration_lock.toml',
      'db/migrations/001_outra_coisa.sql',
      'docker/init.sql',
    ];
    // o pg direto no mesmo app fica de fora: vence o Prisma
    const plan = chaosDbPlan(prismaSurface([{ kind: 'db_write', target: 'audit', via: 'pg' }]), files, [{ file: 'src\\prisma\\schema.prisma', text: SCHEMA }])!;
    expect(plan).toEqual({
      driver: 'prisma',
      schemaFiles: ['src/prisma/migrations/20210924_initial/migration.sql', 'src/prisma/migrations/20211001_tags/migration.sql'],
      tables: ['user'],
      prisma: { schema: 'src/prisma/schema.prisma', envVars: ['DATABASE_URL'] },
    });
    const surface = prismaSurface();
    const source = chaosConfigScaffold(surface, { db: plan });
    expect(parser.withTree(source, false, (root) => root.hasError)).toBe(false);
    expect(parser.withTree(source, false, readChaosConfig)).toMatchObject({ reset: true, setupFiles: ['chaos/setup.ts'] });
    expect(source).toContain('o Prisma do app fala com o PGlite de chaos/db.ts');
    // createApp e o corpo do POST; o banco não é pendência
    expect(chaosConfigPending(source)).toBe(2);
    const scaffold = chaosDbScaffold(plan);
    expect(Object.keys(scaffold)).toEqual(['chaos/db.ts']);
    const db = scaffold['chaos/db.ts']!;
    expect(parser.withTree(db, false, (root) => root.hasError)).toBe(false);
    expect(db).toContain("import { PGLiteSocketServer } from '@electric-sql/pglite-socket';");
    expect(db).toContain("for (const name of ['DATABASE_URL']) process.env[name] = url;");
    expect(db).toContain('connection_limit=1');
    const setup = chaosSetupScaffold({ db: plan })!;
    expect(parser.withTree(setup, false, (root) => root.hasError)).toBe(false);
    expect(setup).toContain("import './db';");
    expect(setup).not.toContain('vi.mock');
    // com o app capturado, o banco sobe antes do express trocado
    const both = chaosSetupScaffold({ db: plan, app: { mode: 'capture', file: 'src/main.ts', line: 7, commonjs: false, foreignListens: [], others: [] } })!;
    expect(both.indexOf("import './db';")).toBeLessThan(both.indexOf("vi.mock('express'"));
    expect(both).toContain("vi.mock('express'");
    expect(both).not.toContain("vi.mock('pg'");
  });

  it('C2d2: sem migrations, o esquema é o SQL do prisma migrate diff; sem ele, uma pendência com o comando', () => {
    const surface = prismaSurface();
    const plan = chaosDbPlan(surface, ['prisma/seed.ts'], [{ file: 'prisma/schema.prisma', text: 'datasource db {\n  provider = "postgresql"\n}\n' }])!;
    // o Prisma 7 tira a url do schema.prisma (vai para o prisma.config.ts): fica a DATABASE_URL
    expect(plan.prisma).toEqual({ schema: 'prisma/schema.prisma', envVars: ['DATABASE_URL'] });
    const command = 'npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script';

    const generated = { ...plan, prisma: { ...plan.prisma!, diff: { command, sql: '\n-- CreateTable\nCREATE TABLE "User" ("id" SERIAL NOT NULL);\n' } } };
    const files = chaosDbScaffold(generated);
    expect(files['chaos/schema.sql']).toContain('CREATE TABLE "User"');
    expect(files['chaos/schema.sql']).toContain(`-- ${command} > chaos/schema.sql`);
    expect(files['chaos/db.ts']).toContain("const SCHEMA = ['chaos/schema.sql'];");
    expect(chaosConfigPending(chaosConfigScaffold(surface, { db: generated }))).toBe(2);

    const failed = { ...plan, prisma: { ...plan.prisma!, diff: { command } } };
    expect(chaosDbScaffold(failed)['chaos/schema.sql']).toContain(`Gere com (o chaos/db.ts aplica este arquivo): ${command}`);
    const source = chaosConfigScaffold(surface, { db: failed });
    expect(chaosConfigPending(source)).toBe(3);
    expect(source).toMatch(/TODO\(shieldepy\): gere o esquema do Prisma em chaos\/schema\.sql/);
  });

  it('C2d2: o schema.prisma é lido por tokens: comentários e strings não enganam, e directUrl entra', () => {
    const text = [
      '// datasource falso { url = env("COMENTARIO") }',
      'generator client {',
      '  provider = "prisma-client-js"',
      '  output   = "../generated/{datasource}"',
      '}',
      'datasource db {',
      '  provider  = "postgresql"',
      '  url       = env("PG_URL") /// a URL do app',
      '  directUrl = env("PG_DIRECT")',
      '}',
    ].join('\n');
    expect(prismaDatasourceEnv(text)).toEqual(['PG_URL', 'PG_DIRECT']);
    expect(prismaTokens('url = env("A\\"B")')).toEqual(['url', '=', 'env', '(', '"A\\"B"', ')']);
    // a cópia que o prisma-client-js põe na pasta do cliente gerado perde para o original, mais raso
    const plan = chaosDbPlan(prismaSurface(), [], [
      { file: 'src/generated/client/schema.prisma', text: SCHEMA },
      { file: 'prisma/schema.prisma', text },
    ])!;
    expect(plan.prisma).toMatchObject({ schema: 'prisma/schema.prisma', envVars: ['PG_URL', 'PG_DIRECT'] });
    expect(chaosDbScaffold(plan)['chaos/db.ts']).toContain("for (const name of ['PG_URL', 'PG_DIRECT']) process.env[name] = url;");
    // Prisma no mapa sem schema.prisma no projeto: não há como montar o banco
    expect(chaosDbPlan(prismaSurface(), [], [])).toBeUndefined();
  });

  it('sem rota sensível, o contrato diz que não há o que testar', () => {
    const source = chaosConfigScaffold({ version: 1, topologyHash: 'x', routes: [], collisions: [] });
    expect(source).toContain('nenhuma rota sensível no mapa');
    expect(source).toContain('nenhuma API externa');
  });
});
