// C2a: onde o app Express nasce, lido do grafo (`RouteScan.apps`), e o `createApp` que o `--init` escreve a partir disso.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chaosAppPlan,
  chaosConfigPending,
  chaosConfigScaffold,
  chaosSetupScaffold,
  findExpressRoutes,
  indexFiles,
  readChaosConfig,
  silentHost,
  toFileId,
  TsParser,
  type AttackSurface,
  type CodeGraph,
  type ExpressApp,
} from '../../src/index';
import { defaultWasmDir } from '../../src/wasm-path';
import { createGraph, Fixture } from '../helpers';

const ROUTER = { 'src/r.ts': "import { Router } from 'express';\nexport const r = Router();\nr.post('/', (q, s) => s.send());\n" };

/** A superfície mínima: só os ids das rotas sensíveis importam para a escolha do app. */
const surfaceWith = (ids: string[]): AttackSurface => ({
  version: 1,
  topologyHash: 'x',
  collisions: [],
  routes: ids.map((id) => ({ id, method: id.split(' ')[0]!, path: id.split(' ')[1]!, at: 'x:1', handlers: [], operations: [], tags: [], collisions: [], confidence: 'proven' as const })),
});

describe('C2a — onde o app Express nasce', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });
  afterEach(() => fx.cleanup());

  /** Indexa os arquivos e devolve os apps com os caminhos relativos à fixture. */
  async function appsOf(files: Record<string, string>): Promise<ExpressApp[]> {
    await indexFiles(graph, Object.entries(files).map(([f, text]) => fx.write(f, text)), silentHost);
    const root = fx.dir.replace(/\\/g, '/').toLowerCase();
    const rel = (f: string) => f.slice(root.length + 1);
    return findExpressRoutes(graph).apps.map((a) => ({ ...a, file: rel(a.file), listens: a.listens.map((l) => ({ ...l, file: rel(l.file) })) }));
  }

  it('exportado e sem listen no arquivo (export default app; o listen fica no server.ts)', async () => {
    const apps = await appsOf({
      'src/app.ts': "import express from 'express';\nconst app = express();\napp.post('/a', (q, s) => s.send());\nexport default app;\n",
      'src/server.ts': "import app from './app';\napp.listen(3000);\n",
    });
    expect(apps).toEqual([
      {
        file: 'src/app.ts',
        line: 1,
        commonjs: false,
        exported: { name: 'default', factory: false },
        listens: [{ file: 'src/server.ts', line: 1, topLevel: true, onApp: true }],
        routes: ['POST /a'],
      },
    ]);
  });

  it('listen no topo em ESM, sem export: o app e as rotas montadas nele (Router() não é app)', async () => {
    const apps = await appsOf({
      'src/index.ts': "import express from 'express';\nimport { r } from './r';\nconst app = express();\napp.use(express.json());\napp.use('/x', r);\napp.listen(3000, () => {});\n",
      ...ROUTER,
    });
    expect(apps).toEqual([{ file: 'src/index.ts', line: 2, commonjs: false, listens: [{ file: 'src/index.ts', line: 5, topLevel: true, onApp: true }], routes: ['POST /x'] }]);
  });

  it('CommonJS: listen no topo, e listen dentro de if (require.main === module) não conta como topo', async () => {
    const top = await appsOf({
      'index.js': "const express = require('express')\nconst app = express()\napp.use('/c', require('./r'))\napp.listen(3000)\n",
      'r.js': "const router = require('express').Router()\nrouter.post('/', (q, s) => s.send())\nmodule.exports = router\n",
    });
    expect(top).toMatchObject([{ file: 'index.js', commonjs: true, listens: [{ line: 3, topLevel: true }], routes: ['POST /c'] }]);
    expect(top[0]!.exported).toBeUndefined();

    const guarded = await appsOf({
      'index.js': "const express = require('express')\nconst app = express()\napp.use('/c', require('./r'))\nif (require.main === module) { app.listen(3000) }\nmodule.exports = app\n",
    });
    expect(guarded).toMatchObject([{ commonjs: true, exported: { name: 'default', factory: false }, listens: [{ line: 3, topLevel: false }] }]);
  });

  it('app criado numa função exportada que o devolve: a fábrica; sem o return, não é fábrica', async () => {
    const apps = await appsOf({
      'src/app.ts': "import express from 'express';\nexport function createApp() {\n  const app = express();\n  app.post('/a', (q, s) => s.send());\n  return app;\n}\n",
      'src/start.ts': "import express from 'express';\nexport function start() {\n  const app = express();\n  app.post('/b', (q, s) => s.send());\n  app.listen(3000);\n}\n",
    });
    expect(apps).toMatchObject([
      { file: 'src/app.ts', exported: { name: 'createApp', factory: true }, listens: [], routes: ['POST /a'] },
      { file: 'src/start.ts', listens: [{ line: 4, topLevel: false, onApp: true }], routes: ['POST /b'] },
    ]);
    expect(apps[1]!.exported).toBeUndefined();
  });

  it('createApp().listen() no mesmo arquivo da fábrica: um listen no topo fora do app', async () => {
    const apps = await appsOf({
      'src/app.ts': "import express from 'express';\nexport const createApp = () => {\n  const app = express();\n  app.post('/a', (q, s) => s.send());\n  return app;\n};\ncreateApp().listen(3000);\n",
    });
    expect(apps).toMatchObject([{ exported: { name: 'createApp', factory: true }, listens: [{ file: 'src/app.ts', line: 6, topLevel: true, onApp: false }] }]);
  });
});

describe('C2a — o createApp do contrato', () => {
  // a raiz como o grafo a escreve (no Windows, `c:/p`)
  const P = toFileId('/p');
  const app = (over: Partial<ExpressApp>): ExpressApp => ({ file: `${P}/src/app.ts`, line: 1, commonjs: false, listens: [], routes: [], ...over });
  const surface = surfaceWith(['POST /a']);

  it('import: exportado e o arquivo não abre porta; capture: abre porta ou não exporta', () => {
    expect(chaosAppPlan([app({ exported: { name: 'default', factory: false } })], surface, P)).toMatchObject({ mode: 'import', file: 'src/app.ts', line: 2 });
    const listening = app({ exported: { name: 'default', factory: false }, listens: [{ file: `${P}/src/app.ts`, line: 9, topLevel: true, onApp: true }] });
    expect(chaosAppPlan([listening], surface, P)).toMatchObject({ mode: 'capture', foreignListens: [] });
    // o listen em outro arquivo (server.ts) não abre porta ao importar o app.ts
    const elsewhere = app({ exported: { name: 'default', factory: false }, listens: [{ file: `${P}/src/server.ts`, line: 1, topLevel: true, onApp: true }] });
    expect(chaosAppPlan([elsewhere], surface, P)).toMatchObject({ mode: 'import' });
    expect(chaosAppPlan([app({})], surface, P)).toMatchObject({ mode: 'capture' });
    expect(chaosAppPlan([], surface, P)).toBeUndefined();
  });

  it('mais de um app: o que tem as rotas sensíveis, e os outros ficam listados', () => {
    const apps = [app({ file: `${P}/examples/demo.ts`, routes: ['GET /x', 'GET /y'] }), app({ file: `${P}/src/app.ts`, line: 4, routes: ['POST /a'] })];
    expect(chaosAppPlan(apps, surface, P)).toMatchObject({ file: 'src/app.ts', line: 5, others: ['examples/demo.ts:2'] });
  });

  it('os contratos gerados compilam, o createApp não é pendência e o setup só troca o express quando guarda o app', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const cases = [
      { plan: chaosAppPlan([app({ exported: { name: 'createApp', factory: true } })], surface, P)!, has: ["import { createApp as projectApp } from './src/app';", 'createApp: () => projectApp(),'] },
      { plan: chaosAppPlan([app({ exported: { name: 'default', factory: false } })], surface, P)!, has: ["import projectApp from './src/app';", 'createApp: () => projectApp,'] },
      {
        plan: chaosAppPlan([app({ file: `${P}/index.js`, commonjs: true, exported: { name: 'default', factory: false } })], surface, P)!,
        has: ["const project = createRequire(import.meta.url)('./index.js');", 'const projectApp = project;'],
      },
      { plan: chaosAppPlan([app({ file: `${P}/src/index.ts` })], surface, P)!, has: ["import './src/index';", 'createApp: () => chaosApp(),', "setupFiles: ['chaos/setup.ts'],"] },
      { plan: chaosAppPlan([app({ file: `${P}/index.js`, commonjs: true })], surface, P)!, has: ["createRequire(import.meta.url)('./index.js');", 'createApp: () => chaosApp(),'] },
    ];
    for (const { plan, has } of cases) {
      const source = chaosConfigScaffold(surface, { app: plan });
      expect(parser.withTree(source, false, (root) => root.hasError), plan.file).toBe(false);
      for (const text of has) expect(source).toContain(text);
      expect(source).not.toContain('preencha createApp');
      // sobram o reset e o corpo do POST
      expect(chaosConfigPending(source)).toBe(2);
      expect(parser.withTree(source, false, readChaosConfig)).toMatchObject({ createApp: true });
      const setup = chaosSetupScaffold({ app: plan });
      if (plan.mode === 'import') expect(setup).toBeUndefined();
      else expect(parser.withTree(setup!, false, (root) => root.hasError)).toBe(false);
    }
  });

  it('listen fora do app no arquivo guardado vira pendência; sem app no mapa, a pendência de hoje', () => {
    const plan = chaosAppPlan([app({ listens: [{ file: `${P}/src/app.ts`, line: 6, topLevel: true, onApp: false }] })], surface, P)!;
    const source = chaosConfigScaffold(surface, { app: plan });
    expect(source).toContain('TODO(shieldepy): src/app.ts:7 abre porta fora do app');
    expect(chaosConfigPending(source)).toBe(3);
    expect(chaosConfigScaffold(surface)).toContain("throw new Error('TODO(shieldepy): preencha createApp no shieldepy.chaos.config.ts');");
  });

  it('com banco e app guardado, o setup troca os dois no mesmo arquivo', () => {
    const plan = chaosAppPlan([app({})], surface, P)!;
    const setup = chaosSetupScaffold({ app: plan, db: { driver: 'pg', schemaFiles: [], tables: [] } })!;
    expect(setup).toContain("vi.mock('express'");
    expect(setup).toContain("vi.mock('pg'");
    expect(setup.match(/createRequire\(import\.meta\.url\)/g)).toHaveLength(1);
  });
});
