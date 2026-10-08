import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from '../src/main';
import { runChaosTests, vitestEntry } from '../src/chaos-run';

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
    expect(has('src/routes/checkout.ts', 'src/controllers/CheckoutController.ts#create', 'references')).toBe(true);
    expect(has('src/controllers/CheckoutController.ts#create', 'src/services/CheckoutService.ts#checkout', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#checkout', 'src/repositories/StockRepository.ts#available', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#checkout', 'src/repositories/StockRepository.ts#decrement', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#checkout', 'src/repositories/OrderRepository.ts#insert', 'calls')).toBe(true);
    expect(has('src/services/CheckoutService.ts#checkout', 'src/gateways/StripeGateway.ts#charge', 'calls')).toBe(true);
    expect(has('src/repositories/OrderRepository.ts#insert', 'pkg:pg', 'calls')).toBe(true);
    // handler inline do GET /orders/:id também entra no mapa
    expect(has("src/routes/checkout.ts#checkoutRouter.get('/orders/:id')", 'src/services/CheckoutService.ts#find', 'calls')).toBe(true);
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
      expect(system.nodes.some((n: { id: string }) => n.id.startsWith('src/services/CheckoutService.ts#checkout'))).toBe(true);
      expect(() => new Function(scripts[5]!)).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('argumentos inválidos → código 2 com o uso', async () => {
    expect((await run('report', 'x', '--fail-on', 'grave')).code).toBe(2);
    expect((await run('voar')).code).toBe(2);
    expect((await run('report', '/nao/existe')).err).toMatch(/erro:/);
    expect(parseArgs(['explain', 'p', '--json'])).toEqual({ command: 'explain', target: 'p', json: true, pg: false, surface: false, noRun: false, offline: false });
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
      expect(checkout.operations[1]).toMatchObject({ kind: 'api_call', target: 'api.stripe.com', at: 'src/gateways/StripeGateway.ts:8', in: 'charge', timeout: 'no' });
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
      expect(fs.readdirSync(chaosDir('checkout-express')).filter((f) => f.endsWith('.spec.ts'))).toHaveLength(4);
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
      expect(out).toMatch(/3 teste\(s\) de caos/);
      expect(fs.existsSync(stale)).toBe(false); // o corrigido tem timeout: não há mais hipótese de timeout
    } finally {
      fs.rmSync(chaosDir('checkout-express-fixed'), { recursive: true, force: true });
    }
  });

  it('sem shieldepy.chaos.config.ts: aborta com o modelo do arquivo; sem --no-run: avisa que rodar é a E4', async () => {
    const noConfig = await run('chaos', example('pedidos-microservices'), '--no-run', '--offline');
    expect(noConfig.code).toBe(2);
    expect(noConfig.err).toMatch(/falta shieldepy\.chaos\.config\.ts/);
    expect(noConfig.err).toMatch(/requests:/);

    const noRun = await run('chaos', example('checkout-express'), '--offline');
    expect(noRun.code).toBe(2);
    expect(noRun.err).toMatch(/chega na E4/);
  });
});

const RACE = 'POST /checkout__race_condition__stock';
const TIMEOUT = 'POST /checkout__timeout__api.stripe.com';
const H5XX = 'POST /checkout__http_5xx_intermittent__api.stripe.com';
const MALFORMED = 'POST /checkout__malformed_response__api.stripe.com';

// De verdade: gera os testes (offline) e roda o Vitest de cada exemplo. Precisa do npm install neles.
// Fica neste arquivo (e não no do runner) porque escreve em examples/*/.shieldepy, como os testes
// acima: no mesmo arquivo eles rodam em sequência, e um não apaga a pasta do outro.
describe('CLI chaos: runner contra os exemplos (E4/4a, Vitest de verdade)', () => {
  for (const [name, expected] of [
    ['checkout-express', { failed: [RACE, TIMEOUT, H5XX, MALFORMED], passed: [] as string[] }],
    ['checkout-express-fixed', { failed: [] as string[], passed: [RACE, H5XX, MALFORMED] }],
  ] as const) {
    it.skipIf(!vitestEntry(example(name)))(
      `${name}: ${expected.failed.length} achado(s), ${expected.passed.length} aprovado(s), nenhum inválido`,
      async () => {
        const dir = example(name);
        try {
          expect((await run('chaos', dir, '--no-run', '--offline')).code).toBe(0);
          const results = await runChaosTests(dir, [...expected.failed, ...expected.passed]);
          expect(results.filter((r) => r.status === 'failed').map((r) => r.hypothesisId).sort()).toEqual([...expected.failed].sort());
          expect(results.filter((r) => r.status === 'passed').map((r) => r.hypothesisId).sort()).toEqual([...expected.passed].sort());
          expect(results.filter((r) => r.status === 'invalid')).toEqual([]);
        } finally {
          fs.rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
        }
      },
      90_000
    );
  }
});

/** Os dados embutidos no HTML do visualizador (`const SYSTEM = ...; const TOPOLOGY = ...;`). */
function embedded(script: string) {
  return new Function(`${script}; return { system: SYSTEM, topology: TOPOLOGY };`)() as { system: any; topology: any };
}
