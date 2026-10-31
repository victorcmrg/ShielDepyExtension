import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from '../src/main';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry } from '@shieldepy/extractors';
import { ChaosRunError, vitestEntry, type TestResult } from '../src/chaos-run';
import { runChaosCommand, type ChaosTestRunner } from '../src/chaos';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const example = (rel: string) => path.join(ROOT, 'examples', rel);

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {} });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('CLI', () => {
  it('report de uma pasta: 3 colisões, com arquivo:linha de cada regra', async () => {
    const { code, out } = await run('report', example('pedidos-microservices/services'));
    expect(code).toBe(0);
    expect(out).toMatch(/3 colisão\(ões\) detectada/);
    expect(out).toMatch(/pricing\/handlers\.ts:\d+/);
  });

  it('--json é parseável', async () => {
    const { out } = await run('report', example('pedidos-spring/services'), '--json');
    const data = JSON.parse(out);
    expect(data.collisions.length).toBe(3);
    expect(data.report.engine).toBe('offline');
  });

  it('explain sem chave cai no explicador offline', async () => {
    const { code, out } = await run('explain', path.join(ROOT, 'fixtures/postgres-example.json'));
    expect(code).toBe(0);
    expect(out).toMatch(/explicador offline/);
    expect(out).toMatch(/🔴 Status: Colisão Identificada/);
  });

  it('--fail-on: portão de CI (1 se houver colisão da severidade pedida ou pior)', async () => {
    const dir = example('pedidos-django/services');
    expect((await run('report', dir, '--fail-on', 'critico')).code).toBe(1); // tem write-write
    const onlyShipping = example('pedidos-django/services/shipping');
    expect((await run('report', onlyShipping, '--fail-on=baixo')).code).toBe(0);
  });

  it('cycles acha o ciclo entre arquivos, uma vez só', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-cli-'));
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), "import { b } from './b';\nexport function a() { b(); }\n");
      fs.writeFileSync(path.join(dir, 'b.ts'), "import { a } from './a';\nexport function b() { a(); }\n");
      const { code, out } = await run('cycles', dir, '--json');
      expect(code).toBe(0);
      expect(JSON.parse(out)).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('graph: checkout-express mapeado 100% e a cadeia rota → controller → service → repositórios → pg', async () => {
    const { code, out } = await run('graph', example('checkout-express'), '--json');
    expect(code).toBe(0);
    const system = JSON.parse(out);
    expect(system.stats).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0, importsUnresolved: 0 });

    const has = (source: string, target: string, type: string) =>
      system.edges.some((e: { source: string; target: string; type: string }) => e.source.startsWith(source) && e.target.startsWith(target) && e.type === type);
    expect(has('src/routes/checkout.ts', 'src/middleware/validate.ts#validateCheckout', 'references')).toBe(true);
    expect(has('src/routes/checkout.ts', 'src/controllers/CheckoutController.ts#CheckoutController.create', 'references')).toBe(true);
    expect(has('src/controllers/CheckoutController.ts#CheckoutController.create', 'src/services/CheckoutService.ts#CheckoutService.checkout', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#CheckoutService.checkout', 'src/repositories/StockRepository.ts#StockRepository.available', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#CheckoutService.checkout', 'src/repositories/StockRepository.ts#StockRepository.decrement', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#CheckoutService.checkout', 'src/repositories/OrderRepository.ts#OrderRepository.insert', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#CheckoutService.checkout', 'src/gateways/StripeGateway.ts#StripeGateway.charge', 'calls')).toBe(true);
    expect(has('src/repositories/OrderRepository.ts#OrderRepository.insert', 'pkg:pg', 'calls')).toBe(true);
    // handler inline do GET /orders/:id também entra no mapa
    expect(has("src/routes/checkout.ts#checkoutRouter.get('/orders/:id')", 'src/services/CheckoutService.ts#CheckoutService.find', 'calls')).toBe(true);
    // ids relativos: o artefato não carrega o caminho da máquina
    expect(out).not.toContain(ROOT.replace(/\\/g, '/'));
  });

  it('graph: mapa determinístico (mesmo hash) e --out grava o arquivo', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-graph-'));
    try {
      const file = path.join(dir, 'sub', 'system-graph.json');
      const first = await run('graph', example('checkout-express'), '--out', file);
      const second = JSON.parse((await run('graph', example('checkout-express'), '--json')).out);
      expect(first.code).toBe(0);
      expect(first.out).toMatch(/100\.0% provadas/);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).contentHash).toBe(second.contentHash);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('graph --html: visualizador autocontido (bibliotecas + dados embutidos, script válido)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-html-'));
    try {
      const file = path.join(dir, 'mapa.html');
      const { code } = await run('graph', example('checkout-express'), '--html', file);
      expect(code).toBe(0);
      const html = fs.readFileSync(file, 'utf8');
      const scripts = html.split('<script>').slice(1).map((s) => s.slice(0, s.indexOf('</script>')));
      // cytoscape, layout-base, cose-base, fcose, dados, app — nada vem de CDN
      expect(scripts).toHaveLength(6);
      expect(html).not.toMatch(/<script src=/);
      const { system, topology } = embedded(scripts[4]!);
      expect(topology).toBeNull();
      expect(system.stats.callsResolved).toBeGreaterThan(0);
      expect(system.nodes.some((n: { id: string }) => n.id.startsWith('src/services/CheckoutService.ts#CheckoutService.checkout'))).toBe(true);
      expect(() => new Function(scripts[5]!)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('argumentos inválidos → código 2 com o uso', async () => {
    expect((await run('report', 'x', '--fail-on', 'grave')).code).toBe(2);
    expect((await run('voar')).code).toBe(2);
    expect((await run('report', '/nao/existe')).err).toMatch(/erro:/);
    expect(parseArgs(['explain', 'p', '--json'])).toEqual({ command: 'explain', target: 'p', json: true, pg: false, surface: false, noRun: false, offline: false, init: false });
  });

  it('topology: rotas, operações em ordem e tags do checkout-express', async () => {
    const { code, out } = await run('topology', example('checkout-express'));
    expect(code).toBe(0);
    expect(out).toMatch(/2 rota\(s\), 2 sensível\(is\), 5 operação\(ões\)/);
    expect(out).toMatch(/POST \/checkout {3}handlers: express\.json\(\) → validateCheckout → checkoutController\.create/);
    const ops = out.split('\n').filter((l) => /^ +\d+ (db_|api_)/.test(l)).map((l) => l.trim().split(/ +/).slice(0, 3).join(' '));
    expect(ops).toEqual(['1 db_read stock', '2 api_call api.stripe.com', '3 db_write stock', '4 db_write orders', '1 db_read orders']);
    expect(out).toMatch(/tags: .*read-then-write\(stock\).*write-after-api-call\(orders,stock\)/);
  });

  it('topology --json / --surface / --out: JSON canônico, estável, e a superfície só com fatos', async () => {
    const a = JSON.parse((await run('topology', example('checkout-express'), '--json')).out);
    const b = JSON.parse((await run('topology', example('checkout-express'), '--json')).out);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.routes.find((r: { id: string }) => r.id === 'POST /checkout').operations).toHaveLength(4);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-topo-'));
    try {
      const file = path.join(dir, '.shieldepy', 'surface.json');
      const { code, err } = await run('topology', example('checkout-express'), '--surface', '--out', file);
      expect(code).toBe(0);
      expect(err).toMatch(/superfície de ataque salva/);
      const surface = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(surface.topologyHash).toBe(a.contentHash);
      const checkout = surface.routes.find((r: { id: string }) => r.id === 'POST /checkout');
      expect(checkout.operations[1]).toMatchObject({ kind: 'api_call', target: 'api.stripe.com', at: 'src/gateways/StripeGateway.ts:8', in: 'StripeGateway.charge', timeout: 'no' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('topology --html: o visualizador recebe a topologia (rotas viram nós) e o script compila', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-html-'));
    try {
      const file = path.join(dir, 'rotas.html');
      expect((await run('topology', example('checkout-express'), '--html', file)).code).toBe(0);
      const html = fs.readFileSync(file, 'utf8');
      const scripts = html.split('<script>').slice(1).map((s) => s.slice(0, s.indexOf('</script>')));
      const { topology } = embedded(scripts[4]!);
      expect(topology.routes.map((r: { id: string }) => r.id)).toEqual(['POST /checkout', 'GET /orders/:id']);
      expect(html).toMatch(/data-filter="routes"/);
      expect(() => new Function(scripts[5]!)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('CLI chaos (E3)', () => {
  const chaosDir = (ex: string) => path.join(example(ex), '.shieldepy', 'chaos-tests');

  it('--no-run --offline: gera os testes do checkout-express, com custo zero e o hash da topologia', async () => {
    try {
      const { code, out } = await run('chaos', example('checkout-express'), '--no-run', '--offline', '--json');
      expect(code).toBe(0);
      const r = JSON.parse(out);
      expect(r.engine).toBe('offline');
      expect(r.cost).toMatchObject({ calls: 0, usd: 0 });
      expect(r.topologyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.written).toContain('.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts');
      expect(r.written).toContain('.shieldepy/chaos-tests/POST__checkout__timeout__api.stripe.com.spec.ts');
      expect(r.warnings).toEqual([]);
      // a rota só de leitura não ganha teste de corrida nem de rede
      expect(r.specs.every((s: { routeId: string }) => s.routeId === 'POST /checkout')).toBe(true);
      expect(fs.readdirSync(chaosDir('checkout-express')).filter((f) => f.endsWith('.spec.ts'))).toHaveLength(6);
    } finally {
      fs.rmSync(chaosDir('checkout-express'), { recursive: true, force: true });
    }
  });

  it('regera do zero: teste de uma hipótese que sumiu não fica para trás', async () => {
    const stale = path.join(chaosDir('checkout-express-fixed'), 'POST__checkout__timeout__api.stripe.com.spec.ts');
    try {
      fs.mkdirSync(path.dirname(stale), { recursive: true });
      fs.writeFileSync(stale, '// velho');
      const { code, out } = await run('chaos', example('checkout-express-fixed'), '--no-run', '--offline');
      expect(code).toBe(0);
      expect(out).toMatch(/5 teste\(s\) de caos/);
      expect(fs.existsSync(stale)).toBe(false); // o corrigido tem timeout: não há mais hipótese de timeout
    } finally {
      fs.rmSync(chaosDir('checkout-express-fixed'), { recursive: true, force: true });
    }
  });

  it('sem shieldepy.chaos.config.ts: aborta com o modelo do arquivo e sugere o --init', async () => {
    const noConfig = await run('chaos', example('pedidos-microservices'), '--no-run', '--offline');
    expect(noConfig.code).toBe(2);
    expect(noConfig.err).toMatch(/falta shieldepy\.chaos\.config\.ts/);
    expect(noConfig.err).toMatch(/requests:/);
    expect(noConfig.err).toMatch(/--init/);
  });

  it('projeto sem JS/TS (C#): o caos não roda e aponta a topologia, sem criar nada', async () => {
    for (const flags of [['--no-run', '--offline'], ['--init']]) {
      const r = await run('chaos', example('pedidos-aspnet'), ...flags);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/só roda em projetos JS\/TS/);
      expect(r.err).toMatch(/shieldepy topology/);
    }
    expect(fs.existsSync(path.join(example('pedidos-aspnet'), 'shieldepy.chaos.config.ts'))).toBe(false);
    expect(fs.existsSync(path.join(example('pedidos-aspnet'), '.shieldepy'))).toBe(false);
  });

  it('--init cria o contrato a partir do mapa, e não sobrescreve um que já existe', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      for (const f of ['src', 'package.json', 'tsconfig.json']) fs.cpSync(path.join(example('checkout-express'), f), path.join(tmp, f), { recursive: true });
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/criado com 2 rota\(s\) sensível\(is\)/);
      const config = fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8');
      // MVP6: o corpo pelos campos que o validateCheckout lê de req.body
      expect(config).toContain("'POST /checkout': { path: '/checkout', body: { cardToken: 'tok_test', priceCents: 1, productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout, checkoutController.create lê");
      expect(config).toContain("'api.stripe.com': () => ({})");
      // C2d: o app usa pg, então o banco de teste sai junto, e o contrato já o usa
      expect(config).toContain("setupFiles: ['chaos/setup.ts']");
      expect(config).toContain('await resetDb();');
      for (const f of ['chaos/db.ts', 'chaos/setup.ts', 'chaos/schema.sql']) expect(fs.existsSync(path.join(tmp, f)), f).toBe(true);
      expect(created.err).toMatch(/não tem \.sql de esquema/);
      // C2a: o src/app.ts exporta a fábrica e não abre porta (o listen é no server.ts): o contrato a importa
      expect(config).toContain("import { createApp as projectApp } from './src/app';");
      expect(config).toContain('createApp: () => projectApp(),');
      expect(created.err).toMatch(/createApp: importado de src\/app\.ts \(a fábrica createApp\)/);
      // o setup só troca o pg: o app não precisa ser guardado
      expect(fs.readFileSync(path.join(tmp, 'chaos', 'setup.ts'), 'utf8')).not.toContain("vi.mock('express'");
      // o package.json do exemplo já declara vitest, supertest, msw e PGlite
      expect(created.err).not.toMatch(/npm install -D/);
      const again = await run('chaos', tmp, '--init');
      expect(again.code).toBe(2);
      expect(again.err).toMatch(/já existe/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--init (C2a): o app CommonJS que abre porta no topo sai guardado pelo setup, sem pendência no createApp', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4' } }));
      // o pg-crud da C1: index.js monta o app, chama listen() no topo e não exporta nada
      fs.writeFileSync(
        path.join(tmp, 'index.js'),
        "const express = require('express')\nconst app = express()\napp.use(express.json())\napp.use('/categories', require('./routes/category'))\napp.listen(3000)\n"
      );
      fs.mkdirSync(path.join(tmp, 'routes'));
      fs.writeFileSync(path.join(tmp, 'routes', 'category.js'), "const router = require('express').Router()\nrouter.post('/', (req, res) => res.status(201).end())\nmodule.exports = router\n");
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/createApp: guardado pelo chaos\/setup\.ts ao importar index\.js/);
      const config = fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8');
      expect(config).toContain("createRequire(import.meta.url)('./index.js');");
      expect(config).toContain('createApp: () => chaosApp(),');
      expect(config).toContain("setupFiles: ['chaos/setup.ts']");
      expect(config).not.toContain('preencha createApp');
      // sem banco no mapa: o setup só tem a troca do express, e não há chaos/db.ts
      const setup = fs.readFileSync(path.join(tmp, 'chaos', 'setup.ts'), 'utf8');
      expect(setup).toContain("vi.mock('express'");
      expect(setup).not.toContain("vi.mock('pg'");
      expect(fs.existsSync(path.join(tmp, 'chaos', 'db.ts'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--init (C2a): sem express() no mapa, o createApp continua pendente e não há setup', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      fs.writeFileSync(path.join(tmp, 'index.js'), "const http = require('node:http')\nhttp.createServer((req, res) => res.end()).listen(3000)\n");
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/createApp: nenhum app Express/);
      expect(fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8')).toContain('preencha createApp');
      expect(fs.existsSync(path.join(tmp, 'chaos'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('C2f (MVP3): um framework que o mapa não lê dá 0 rotas, e o caos sai 2 (nada provado), não 0', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-fw-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '10', koa: '2' } }));
      fs.writeFileSync(path.join(tmp, 'main.ts'), "import Koa from 'koa';\nconst app = new Koa();\napp.use(async (ctx) => { ctx.body = 'ok'; });\napp.listen(3000);\n");
      fs.writeFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'export default { createApp: () => null, requests: {} };\n');
      const blind = await run('chaos', tmp, '--offline');
      expect(blind.code).toBe(2);
      expect(blind.err).toMatch(/o projeto usa Koa, que o ShielDepy ainda não lê: o mapa não achou nenhuma rota/);
      expect(blind.err).toMatch(/nada foi provado/);

      // com rotas de Express também: só o aviso, e o portão segue as rotas que o mapa viu
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4', koa: '2' } }));
      fs.writeFileSync(path.join(tmp, 'app.ts'), "import express from 'express';\nexport const app = express();\napp.get('/health', (req, res) => res.end());\n");
      const mixed = await run('chaos', tmp, '--offline', '--no-run');
      expect(mixed.code).toBe(0);
      expect(mixed.err).toMatch(/o projeto também usa Koa, que o ShielDepy ainda não lê: as rotas de lá ficam fora/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--init (C2d): usa as migrations .sql do projeto, não sobrescreve um chaos/db.ts e diz o que instalar', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      for (const f of ['src', 'tsconfig.json']) fs.cpSync(path.join(example('checkout-express'), f), path.join(tmp, f), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4', pg: '8' }, devDependencies: { vitest: '2' } }));
      fs.mkdirSync(path.join(tmp, 'db', 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'db', 'migrations', '002_orders.sql'), 'CREATE TABLE orders (id SERIAL PRIMARY KEY);');
      fs.writeFileSync(path.join(tmp, 'db', 'migrations', '001_stock.sql'), 'CREATE TABLE stock (product_id TEXT PRIMARY KEY);');
      fs.writeFileSync(path.join(tmp, 'db', 'seed.sql'), "INSERT INTO stock VALUES ('p-1');");
      fs.mkdirSync(path.join(tmp, 'chaos'));
      fs.writeFileSync(path.join(tmp, 'chaos', 'db.ts'), '// do projeto');
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/chaos\/db\.ts já existe: mantido/);
      expect(fs.readFileSync(path.join(tmp, 'chaos', 'db.ts'), 'utf8')).toBe('// do projeto');
      expect(created.err).toMatch(/esquema: db\/migrations\/001_stock\.sql, db\/migrations\/002_orders\.sql/);
      expect(fs.existsSync(path.join(tmp, 'chaos', 'schema.sql'))).toBe(false);
      // MVP2: o que a CLI tem (o arnês) é emprestado, não pedido
      expect(created.err).toMatch(/o projeto não tem supertest, msw, @electric-sql\/pglite: o caos usa os do ShielDepy, sem instalar nada no projeto/);
      expect(created.err).not.toMatch(/npm install -D/);
      expect(fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8')).not.toMatch(/não tem \.sql de esquema/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // um app Express com Prisma, como o realworld da C1: checa a unicidade e depois cria
  const PRISMA_APP =
    "import express from 'express';\nimport { PrismaClient } from '@prisma/client';\nconst prisma = new PrismaClient();\nconst app = express();\napp.use(express.json());\napp.post('/users', async (req, res) => {\n  const found = await prisma.user.findUnique({ where: { email: req.body.email } });\n  if (found) return res.status(422).end();\n  await prisma.user.create({ data: { email: req.body.email } });\n  res.status(201).end();\n});\napp.listen(3000);\n";
  const PRISMA_SCHEMA = 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\nmodel User {\n  id    Int    @id @default(autoincrement())\n  email String @unique\n}\n';

  it('--init (C2d2): Prisma com migrations: o banco pelo socket, a URL do datasource e o que instalar', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4', '@prisma/client': '4' }, devDependencies: { vitest: '2', supertest: '7', msw: '2' } }));
      fs.mkdirSync(path.join(tmp, 'src', 'prisma', 'migrations', '20240101_init'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'main.ts'), PRISMA_APP);
      fs.writeFileSync(path.join(tmp, 'src', 'prisma', 'schema.prisma'), PRISMA_SCHEMA);
      fs.writeFileSync(path.join(tmp, 'src', 'prisma', 'migrations', '20240101_init', 'migration.sql'), 'CREATE TABLE "User" ("id" SERIAL PRIMARY KEY, "email" TEXT NOT NULL);');
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/esquema: src\/prisma\/migrations\/20240101_init\/migration\.sql/);
      expect(created.err).toMatch(/npx prisma generate/);
      expect(created.err).toMatch(/o projeto não tem @electric-sql\/pglite, @electric-sql\/pglite-socket: o caos usa os do ShielDepy/);
      const db = fs.readFileSync(path.join(tmp, 'chaos', 'db.ts'), 'utf8');
      expect(db).toContain("const SCHEMA = ['src/prisma/migrations/20240101_init/migration.sql'];");
      expect(db).toContain("for (const name of ['DATABASE_URL']) process.env[name] = url;");
      // o app abre porta no topo: o setup guarda o express (C2a) e sobe o banco antes, sem trocar o pg
      const setup = fs.readFileSync(path.join(tmp, 'chaos', 'setup.ts'), 'utf8');
      expect(setup).toContain("import './db';");
      expect(setup.indexOf("import './db';")).toBeLessThan(setup.indexOf("vi.mock('express'"));
      expect(setup).not.toContain("vi.mock('pg'");
      const config = fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8');
      expect(config).toContain('await resetDb();');
      expect(config).toContain('createApp: () => chaosApp(),');
      expect(config).not.toMatch(/zere o banco|esquema/);
      expect(fs.existsSync(path.join(tmp, 'chaos', 'schema.sql'))).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('--init (C2d2): Prisma sem migrations: o esquema sai do prisma migrate diff do projeto (a flag antiga, se a nova falhar)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-init-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ dependencies: { express: '4', '@prisma/client': '4' } }));
      fs.mkdirSync(path.join(tmp, 'src'));
      fs.mkdirSync(path.join(tmp, 'prisma'));
      fs.writeFileSync(path.join(tmp, 'src', 'main.ts'), PRISMA_APP);
      fs.writeFileSync(path.join(tmp, 'prisma', 'schema.prisma'), PRISMA_SCHEMA);
      // o Prisma 4 não conhece o --to-schema do Prisma 7; e o 7 exige a URL até para o diff, que não conecta
      const fake = path.join(tmp, 'node_modules', 'prisma');
      fs.mkdirSync(path.join(fake, 'build'), { recursive: true });
      fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'prisma', version: '4.16.2', bin: { prisma: 'build/index.js' } }));
      fs.writeFileSync(
        path.join(fake, 'build', 'index.js'),
        "const args = process.argv.slice(2);\nif (args.includes('--to-schema') || !process.env.DATABASE_URL) { console.error('unknown or unexpected option: --to-schema'); process.exit(1); }\nconsole.log('-- CreateTable\\nCREATE TABLE \"User\" (\"id\" SERIAL NOT NULL); -- ' + args.join(' '));\n"
      );
      const created = await run('chaos', tmp, '--init');
      expect(created.code).toBe(0);
      expect(created.err).toMatch(/esquema: chaos\/schema\.sql, gerado de prisma\/schema\.prisma/);
      const schema = fs.readFileSync(path.join(tmp, 'chaos', 'schema.sql'), 'utf8');
      expect(schema).toContain('CREATE TABLE "User" ("id" SERIAL NOT NULL); -- migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script');
      expect(schema).toContain('-- npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > chaos/schema.sql');
      expect(fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8')).not.toMatch(/esquema/);

      // sem o Prisma instalado: o esquema vira pendência, com o comando
      fs.rmSync(path.join(tmp, 'node_modules'), { recursive: true });
      fs.rmSync(path.join(tmp, 'chaos'), { recursive: true });
      fs.rmSync(path.join(tmp, 'shieldepy.chaos.config.ts'));
      const missing = await run('chaos', tmp, '--init');
      expect(missing.err).toMatch(/não conseguiu gerar o esquema: rode npx prisma migrate diff --from-empty --to-schema prisma\/schema\.prisma --script > chaos\/schema\.sql/);
      expect(fs.readFileSync(path.join(tmp, 'shieldepy.chaos.config.ts'), 'utf8')).toMatch(/TODO\(shieldepy\): gere o esquema do Prisma/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

const RACE = 'POST /checkout__race_condition__stock';
const TIMEOUT = 'POST /checkout__timeout__api.stripe.com';
const H5XX = 'POST /checkout__http_5xx_intermittent__api.stripe.com';
const MALFORMED = 'POST /checkout__malformed_response__api.stripe.com';
const PARTIAL_ORDERS = 'POST /checkout__partial_failure_after_external_call__orders';
const PARTIAL_STOCK = 'POST /checkout__partial_failure_after_external_call__stock';

describe('CLI chaos: portão (E4/4b, runner injetado)', () => {
  const dir = example('checkout-express');
  const registry = () => loadRegistry(defaultWasmDir());
  async function gate(runner: ChaosTestRunner, failOn?: 'Crítico' | 'Alto') {
    const out: string[] = [];
    const err: string[] = [];
    try {
      const code = await runChaosCommand({ target: dir, json: false, noRun: false, offline: true, failOn }, { out: (l) => out.push(l), err: (l) => err.push(l), env: {} }, registry, runner);
      return { code, out: out.join('\n'), err: err.join('\n') };
    } finally {
      fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
    }
  }
  const results = (byId: Record<string, [TestResult['status'], string?]>): ChaosTestRunner => async (_root, ids) =>
    ids.map((id) => ({ hypothesisId: id, status: byId[id]?.[0] ?? 'passed', message: byId[id]?.[1], durationMs: 10 }));

  it('roda só as hipóteses com teste; achado → exit 1, com a severidade e a mensagem', async () => {
    let asked: string[] = [];
    const r = await gate(async (root, ids) => {
      asked = ids;
      return results({ [RACE]: ['failed', 'stateCheck: stockNeverNegative'], [TIMEOUT]: ['failed', 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta'] })(root, ids);
    });
    expect(asked.sort()).toEqual([H5XX, MALFORMED, PARTIAL_ORDERS, PARTIAL_STOCK, RACE, TIMEOUT].sort());
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/2 achado\(s\), 4 aguentou\(aram\), 0 inválido/);
    expect(r.out).toMatch(/✖ Crítico\s+race_condition[\s\S]*stateCheck: stockNeverNegative/);
    expect(r.out).toMatch(/✖ Alto\s+timeout/);
    expect(r.err).toContain('portão: 2 achado(s) de caos.');
  });

  it('V2a: grava .shieldepy/chaos-results.json sempre, e --html põe o resultado por cima do mapa', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-v2a-'));
    const html = path.join(tmp, 'mapa.html');
    try {
      const io = { out: () => {}, err: () => {}, env: {} };
      const code = await runChaosCommand({ target: dir, json: false, noRun: false, offline: true, html }, io, registry, results({ [RACE]: ['failed', 'stateCheck: stockNeverNegative'] }));
      expect(code).toBe(1);
      const file = JSON.parse(fs.readFileSync(path.join(dir, '.shieldepy', 'chaos-results.json'), 'utf8'));
      expect(file).toMatchObject({ version: 1, project: 'checkout-express', ran: true, failOn: 'Baixo', hits: 1 });
      expect(file.topologyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(file.outcomes.find((o: { hypothesisId: string }) => o.hypothesisId === RACE)).toMatchObject({
        status: 'failed',
        severity: 'Crítico',
        testFile: '.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts',
      });
      expect(file.untested).toEqual([]); // desde a E6, a falha parcial também tem teste
      const scripts = fs.readFileSync(html, 'utf8').split('<script>').slice(1).map((s) => s.slice(0, s.indexOf('</script>')));
      const { topology, overlay } = embedded(scripts[4]!);
      expect(overlay.chaos.topologyHash).toBe(topology.contentHash);
      expect(overlay.chaos.outcomes).toHaveLength(6);
      expect(() => new Function(scripts[5]!)).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      // só o que este teste criou: o de compilação (agent) usa .shieldepy/tsc-check ao mesmo tempo
      fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
      fs.rmSync(path.join(dir, '.shieldepy', 'chaos-results.json'), { force: true });
    }
  });

  it('--report grava o markdown do PR, inclusive quando o ambiente falhou', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-report-'));
    const report = path.join(tmp, 'sub', 'chaos-report.md');
    try {
      const out: string[] = [];
      const io = { out: (l: string) => out.push(l), err: (l: string) => out.push(l), env: {} };
      const args = { target: dir, json: false, noRun: false, offline: true, report };
      const code = await runChaosCommand(args, io, registry, results({ [RACE]: ['failed', 'stateCheck: stockNeverNegative'] }));
      expect(code).toBe(1);
      const md = fs.readFileSync(report, 'utf8');
      expect(md).toMatch(/^<!-- shieldepy-chaos -->/);
      expect(md).toContain('> ❌ **Bloqueado:** 1 achado(s).');
      expect(md).toContain('| 🔴 Crítico | `POST /checkout` | `race_condition` | `stock` | stateCheck: stockNeverNegative |');
      expect(md).toContain('**Resumo:** requisições simultâneas em POST /checkout corrompem stock');
      expect(out.join('\n')).toMatch(/relatório salvo em/);

      const crashed = await runChaosCommand(args, io, registry, async () => {
        throw new ChaosRunError('o Vitest não está instalado em x');
      });
      expect(crashed).toBe(2);
      expect(fs.readFileSync(report, 'utf8')).toContain('**Os testes não rodaram (erro de ambiente).** o Vitest não está instalado em x');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
    }
  });

  it('--fail-on Crítico deixa passar um achado Alto; inválido nunca bloqueia', async () => {
    const r = await gate(results({ [TIMEOUT]: ['failed', 'respondsWithin: x'], [H5XX]: ['invalid', 'o controle (sem caos) falhou: y'] }), 'Crítico');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\? inválido[\s\S]*não conta: o controle \(sem caos\) falhou: y/);
  });

  it('erro de ambiente → exit 2: o Vitest não rodou, ou todos os testes são inválidos', async () => {
    const crashed = await gate(async () => {
      throw new ChaosRunError('o Vitest não está instalado em x');
    });
    expect(crashed.code).toBe(2);
    expect(crashed.err).toMatch(/erro de ambiente: o Vitest não está instalado/);

    const allInvalid = await gate(async (_root, ids) => ids.map((id) => ({ hypothesisId: id, status: 'invalid' as const, message: 'controle falhou', durationMs: 0 })));
    expect(allInvalid.code).toBe(2);
    expect(allInvalid.err).toMatch(/nenhum teste de caos foi válido/);
  });
});

// De verdade: gera os testes (offline), roda o Vitest de cada exemplo e aplica o portão. Precisa do
// npm install neles. Fica neste arquivo porque escreve em examples/*/.shieldepy, como os testes
// acima: no mesmo arquivo eles rodam em sequência, e um não apaga a pasta do outro.
describe('CLI chaos: aceitação contra os exemplos (E4, Vitest de verdade)', () => {
  for (const [name, expected] of [
    ['checkout-express', { code: 1, failed: [RACE, TIMEOUT, H5XX, MALFORMED, PARTIAL_ORDERS, PARTIAL_STOCK], passed: [] as string[], invalid: [] as string[] }],
    // o corrigido estorna e devolve a reserva quando o INSERT do pedido falha (antes da D4, esse era o
    // achado da E6); o `stock` só é gravado depois da API no caminho de erro (release), então a falha
    // não dispara: inválido, que não conta no portão
    ['checkout-express-fixed', { code: 0, failed: [] as string[], passed: [RACE, H5XX, MALFORMED, PARTIAL_ORDERS], invalid: [PARTIAL_STOCK] }],
  ] as const) {
    it.skipIf(!vitestEntry(example(name)))(
      `${name}: exit ${expected.code}, ${expected.failed.length} achado(s), ${expected.passed.length} aprovado(s), ${expected.invalid.length} inválido(s)`,
      async () => {
        const dir = example(name);
        try {
          const { code, out } = await run('chaos', dir, '--offline', '--json');
          expect(code).toBe(expected.code);
          const r = JSON.parse(out) as { results: TestResult[] };
          const ids = (status: string) => r.results.filter((x) => x.status === status).map((x) => x.hypothesisId).sort();
          expect(ids('failed')).toEqual([...expected.failed].sort());
          expect(ids('passed')).toEqual([...expected.passed].sort());
          expect(ids('invalid')).toEqual([...expected.invalid].sort());
        } finally {
          fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
        }
      },
      // ~20 s sozinho; no `npm run check`, o Vitest do exemplo disputa a CPU com os outros forks (passou de 90 s)
      240_000
    );
  }

  // MVP4: o mesmo checkout em Fastify (plugin com prefixo /api), só com o fastify e o pg instalados: o
  // arnês é o da CLI, o createApp é o que o --init gerou, e o quadro é o mesmo dos exemplos Express
  const api = (id: string) => id.replace('POST /checkout', 'POST /api/checkout');
  for (const [name, expected] of [
    ['checkout-fastify', { code: 1, failed: [RACE, TIMEOUT, H5XX, MALFORMED, PARTIAL_ORDERS, PARTIAL_STOCK], passed: [] as string[], invalid: [] as string[] }],
    ['checkout-fastify-fixed', { code: 0, failed: [] as string[], passed: [RACE, H5XX, MALFORMED, PARTIAL_ORDERS], invalid: [PARTIAL_STOCK] }],
  ] as const) {
    it.skipIf(!fs.existsSync(path.join(example(name), 'node_modules', 'fastify')))(
      `MVP4 ${name}: exit ${expected.code}, ${expected.failed.length} achado(s), ${expected.passed.length} aprovado(s), ${expected.invalid.length} inválido(s)`,
      async () => {
        const dir = example(name);
        try {
          const { code, out } = await run('chaos', dir, '--offline', '--json');
          expect(code).toBe(expected.code);
          const r = JSON.parse(out) as { results: TestResult[] };
          const ids = (status: string) => r.results.filter((x) => x.status === status).map((x) => x.hypothesisId).sort();
          expect(ids('failed')).toEqual(expected.failed.map(api).sort());
          expect(ids('passed')).toEqual(expected.passed.map(api).sort());
          expect(ids('invalid')).toEqual(expected.invalid.map(api).sort());
        } finally {
          fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
        }
      },
      240_000
    );
  }

  // MVP2: o mesmo checkout-express num projeto sem Vitest, supertest, MSW nem PGlite (só o express e o
  // pg, ligados aos do exemplo): o caos roda com o arnês da CLI e acha o mesmo que acima
  it.skipIf(!vitestEntry(example('checkout-express')))(
    'MVP2: sem o arnês no projeto, o caos usa o da CLI, sem instalar nada nele, e acha o mesmo',
    async () => {
      const src = example('checkout-express');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-arnes-'));
      try {
        for (const f of ['src', 'chaos/db.ts', 'chaos/setup.ts', 'shieldepy.chaos.config.ts', 'tsconfig.json']) fs.cpSync(path.join(src, f), path.join(tmp, f), { recursive: true });
        const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')) as { dependencies: object };
        fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ type: 'module', dependencies: pkg.dependencies }));
        // o alias @/ do exemplo, num config do Vite que não importa o Vitest
        fs.writeFileSync(path.join(tmp, 'vite.config.ts'), "import { fileURLToPath } from 'node:url';\nexport default { resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } } };\n");
        fs.mkdirSync(path.join(tmp, 'node_modules'));
        for (const dep of ['express', 'pg']) fs.symlinkSync(path.join(src, 'node_modules', dep), path.join(tmp, 'node_modules', dep), 'junction');

        const { code, out, err } = await run('chaos', tmp, '--offline', '--json');
        expect(err).toMatch(/com o Vitest do ShielDepy; do ShielDepy, sem instalar nada no projeto: vitest, supertest, msw, @electric-sql\/pglite/);
        expect(code).toBe(1);
        const r = JSON.parse(out) as { results: TestResult[] };
        expect(r.results.filter((x) => x.status === 'failed').map((x) => x.hypothesisId).sort()).toEqual([RACE, TIMEOUT, H5XX, MALFORMED, PARTIAL_ORDERS, PARTIAL_STOCK].sort());
        expect(fs.readdirSync(path.join(tmp, 'node_modules')).sort()).toEqual(['express', 'pg']);
        expect(fs.existsSync(path.join(tmp, 'package-lock.json'))).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
    240_000
  );
});

/** Os dados embutidos no HTML do visualizador (`const SYSTEM = ...; const TOPOLOGY = ...;`). */
function embedded(script: string) {
  return new Function(`${script}; return { system: SYSTEM, topology: TOPOLOGY, overlay: OVERLAY };`)() as { system: any; topology: any; overlay: any };
}
