import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main, parseArgs } from '../src/main';

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
      const data = scripts[4]!;
      const system = JSON.parse(data.slice(data.indexOf('=') + 1).trim().replace(/;$/, ''));
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
    expect(parseArgs(['explain', 'p', '--json'])).toEqual({ command: 'explain', target: 'p', json: true, pg: false });
  });
});
