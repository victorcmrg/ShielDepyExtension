// O createApp que o `--init` gera para um app Fastify que abre porta no topo do arquivo (MVP4, modo
// capture), executado de verdade, como o chaos-app.test.ts faz com o Express. Os arquivos vão para uma
// pasta ignorada pelo git dentro do examples/checkout-fastify (onde o fastify está instalado); o Vitest e
// o supertest são os da raiz do repositório, achados subindo as pastas, como os do arnês da CLI.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaosAppPlan, chaosConfigScaffold, chaosSetupScaffold, toFileId, type AttackSurface, type ExpressApp } from '../src';
import { REPO_ROOT } from './helpers';

const EXAMPLE = path.join(REPO_ROOT, 'examples', 'checkout-fastify');
const dir = path.join(EXAMPLE, '.shieldepy', `mvp4-${process.pid}`);
// sem o `npm install` do exemplo, o teste é pulado
const installed = fs.existsSync(path.join(EXAMPLE, 'node_modules', 'fastify'));
const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const surface: AttackSurface = { version: 1, topologyHash: 'x', routes: [], collisions: [] };

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer().listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });

/** O mesmo app nos dois formatos: plugin com prefixo e listen no topo do arquivo, sem export. */
const APPS: Record<string, { file: string; commonjs: boolean; text: (port: number) => string }> = {
  esm: {
    file: 'esm/index.ts',
    commonjs: false,
    text: (port) =>
      [
        "import Fastify from 'fastify';",
        'const app = Fastify();',
        "app.register(async (r) => { r.post('/echo', async (req, reply) => reply.code(201).send(req.body)); }, { prefix: '/api' });",
        `app.listen({ port: ${port} }, (err) => { if (err) throw err; });`,
        '',
      ].join('\n'),
  },
  cjs: {
    file: 'cjs/index.js',
    commonjs: true,
    text: (port) =>
      [
        "const fastify = require('fastify')",
        'const app = fastify()',
        "app.register(async (r) => { r.post('/echo', async (req, reply) => reply.code(201).send(req.body)) }, { prefix: '/api' })",
        `app.listen({ port: ${port} }).then((address) => console.log(address))`,
        '',
      ].join('\n'),
  },
};

let port: number;
let run: ReturnType<typeof spawnSync>;

beforeAll(async () => {
  if (!installed) return;
  port = await freePort();
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  for (const [name, app] of Object.entries(APPS)) {
    write(app.file, app.text(port));
    const found: ExpressApp = { file: `${toFileId(dir)}/${app.file}`, line: 1, commonjs: app.commonjs, framework: 'fastify', listens: [], routes: [] };
    const plan = chaosAppPlan([found], surface, dir)!;
    expect(plan.mode).toBe('capture');
    write(`${name}.config.ts`, chaosConfigScaffold(surface, { app: plan }));
    write('chaos/setup.ts', chaosSetupScaffold({ app: plan })!);
    write(
      `${name}.spec.ts`,
      [
        "import * as net from 'node:net';",
        "import request from 'supertest';",
        "import { expect, it } from 'vitest';",
        `import config from './${name}.config';`,
        '',
        "it('sobe o app Fastify sem abrir porta, com o prefixo do plugin', async () => {",
        '  const app = config.createApp() as Parameters<typeof request>[0];',
        "  const res = await request(app).post('/api/echo').send({ a: 1 });",
        '  expect(res.status).toBe(201);',
        '  expect(res.body).toEqual({ a: 1 });',
        "  expect((await request(app).get('/nada')).status).toBe(404);",
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
  // o checkout-fastify é "type": "module"
  write('cjs/package.json', '{ "type": "commonjs" }\n');
  write('vitest.config.mjs', "export default { test: { include: ['*.spec.ts'], setupFiles: ['chaos/setup.ts'], fileParallelism: false } };\n");
  run = spawnSync(process.execPath, [VITEST, 'run', '--config', 'vitest.config.mjs', '--reporter=json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 120000,
  });
}, 150000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!installed)('MVP4 — o app Fastify guardado pelo setup gerado', () => {
  it('ESM e CommonJS: o createApp atende pelo handler que espera o ready(), e o listen() não abre porta', () => {
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
