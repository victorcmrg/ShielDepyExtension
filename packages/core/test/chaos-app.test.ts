// O createApp que o `--init` gera quando o arquivo do app abre porta (C2a, caso b), executado de verdade:
// o contrato e o chaos/setup.ts gerados vão para uma pasta ignorada pelo git dentro do examples/checkout-express
// (o único lugar do repositório com express, supertest e Vitest instalados), e o Vitest dele roda num processo
// à parte, com o setup no setupFiles, como nos testes de caos.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaosAppPlan, chaosConfigScaffold, chaosSetupScaffold, toFileId, type AttackSurface, type ExpressApp } from '../src';
import { REPO_ROOT } from './helpers';

const EXAMPLE = path.join(REPO_ROOT, 'examples', 'checkout-express');
const dir = path.join(EXAMPLE, '.shieldepy', `c2a-${process.pid}`);
const surface: AttackSurface = { version: 1, topologyHash: 'x', routes: [], collisions: [] };

/** Uma porta livre agora: o app de teste tenta ouvir nela, e o teste confere que ela continua livre. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/** O mesmo app nos dois formatos: abre porta no topo do arquivo e não exporta nada (os 3 projetos da C1). */
const APPS: Record<string, { file: string; commonjs: boolean; text: (port: number) => string }> = {
  esm: {
    file: 'esm/index.ts',
    commonjs: false,
    text: (port) =>
      [
        "import express, { Router } from 'express';",
        'const app = express();',
        'app.use(express.json());',
        'const r = Router();',
        "r.post('/echo', (req, res) => { res.status(201).json(req.body); });",
        "app.use('/api', r);",
        `app.listen(${port}, () => console.log('ouvindo'));`,
        '',
      ].join('\n'),
  },
  cjs: {
    file: 'cjs/index.js',
    commonjs: true,
    text: (port) =>
      [
        "const express = require('express')",
        'const app = express()',
        'app.use(express.json())',
        'const r = express.Router()',
        "r.post('/echo', (req, res) => { res.status(201).json(req.body) })",
        "app.use('/api', r)",
        `const server = app.listen(${port})`,
        "server.on('error', (err) => { throw err })",
        '',
      ].join('\n'),
  },
};

let port: number;
let run: ReturnType<typeof spawnSync>;

beforeAll(async () => {
  port = await freePort();
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  for (const [name, app] of Object.entries(APPS)) {
    write(app.file, app.text(port));
    const found: ExpressApp = { file: `${toFileId(dir)}/${app.file}`, line: 1, commonjs: app.commonjs, listens: [], routes: [] };
    const plan = chaosAppPlan([found], surface, dir)!;
    expect(plan.mode).toBe('capture');
    write(`${name}.config.ts`, chaosConfigScaffold(surface, { app: plan }));
    // os dois planos geram o mesmo setup (o arquivo só entra na mensagem de erro)
    write('chaos/setup.ts', chaosSetupScaffold({ app: plan })!);
    write(
      `${name}.spec.ts`,
      [
        "import * as net from 'node:net';",
        "import request from 'supertest';",
        "import { expect, it } from 'vitest';",
        `import config from './${name}.config';`,
        '',
        "it('sobe o app sem abrir porta', async () => {",
        '  const app = config.createApp() as Parameters<typeof request>[0];',
        "  const res = await request(app).post('/api/echo').send({ a: 1 });",
        '  expect(res.status).toBe(201);',
        '  expect(res.body).toEqual({ a: 1 });',
        '  // a porta do listen() do projeto continua livre',
        '  await new Promise<void>((resolve, reject) => {',
        `    const probe = net.createServer().listen(${port}, () => probe.close(() => resolve()));`,
        "    probe.on('error', reject);",
        '  });',
        '});',
        '',
      ].join('\n')
    );
  }
  // o checkout-express é "type": "module"; um projeto CommonJS (o pg-crud da C1) não declara nada
  write('cjs/package.json', '{ "type": "commonjs" }\n');
  write('vitest.config.mjs', "export default { test: { include: ['*.spec.ts'], setupFiles: ['chaos/setup.ts'] } };\n");
  run = spawnSync(process.execPath, [path.join(EXAMPLE, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--config', 'vitest.config.mjs', '--reporter=json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 120000,
  });
}, 150000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('C2a — o app guardado pelo setup gerado', () => {
  it('ESM e CommonJS: o createApp devolve o app que o arquivo criou, e o listen() dele não abre porta', () => {
    const out = String(run.stdout);
    const report = JSON.parse(out.slice(out.indexOf('{'))) as { testResults: { name: string; status: string; message?: string; assertionResults: { status: string; failureMessages: string[] }[] }[] };
    const byFile = Object.fromEntries(report.testResults.map((t) => [path.basename(t.name), t]));
    for (const name of Object.keys(APPS)) {
      const result = byFile[`${name}.spec.ts`];
      expect(result, `${name}: ${String(run.stderr).slice(-2000)}`).toBeDefined();
      expect(result!.status, `${name}: ${result!.message ?? ''} ${result!.assertionResults.flatMap((a) => a.failureMessages).join('\n')}`).toBe('passed');
    }
    expect(run.status).toBe(0);
  });
});
