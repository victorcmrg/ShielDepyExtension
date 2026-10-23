import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MapDiff } from '@shieldepy/core';
import { main } from '../src/main';

const EXAMPLE = fileURLToPath(new URL('../../../examples/checkout-express', import.meta.url));

/** Cópia do checkout-express num repositório git próprio, com um commit inicial. */
function gitCopy(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-diff-'));
  fs.cpSync(EXAMPLE, dir, { recursive: true, filter: (src) => !/[\\/](node_modules|\.shieldepy)([\\/]|$)/.test(src) });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '--quiet');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'base');
  return dir;
}

async function diff(dir: string): Promise<{ code: number; diff: MapDiff; changedFiles: string[] }> {
  const out: string[] = [];
  const code = await main(['diff', dir, '--base', 'HEAD', '--json'], { out: (l) => out.push(l), err: () => {}, env: {} });
  const r = JSON.parse(out.join('\n'));
  return { code, diff: r.diff, changedFiles: r.changedFiles };
}

describe('E5/5c — shieldepy diff --base', () => {
  let dir: string;
  const file = (rel: string) => path.join(dir, rel);
  const edit = (rel: string, from: string, to: string) => {
    const text = fs.readFileSync(file(rel), 'utf8');
    expect(text).toContain(from);
    fs.writeFileSync(file(rel), text.replace(from, to));
  };
  const reset = () => execFileSync('git', ['checkout', '--quiet', '--', '.'], { cwd: dir });

  beforeAll(() => {
    dir = gitCopy();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('comentário e linhas em branco: o git vê mudança, o mapa não', async () => {
    edit('src/gateways/StripeGateway.ts', 'export class StripeGateway', '// comentário novo\n\n\nexport class StripeGateway');
    try {
      const r = await diff(dir);
      expect(r.code).toBe(0);
      expect(r.changedFiles).toEqual(['src/gateways/StripeGateway.ts']);
      expect(r.diff.empty).toBe(true);
    } finally {
      reset();
    }
  });

  it('corpo alterado: só o método (e a classe dele) aparecem como changed', async () => {
    edit('src/gateways/StripeGateway.ts', "currency: 'brl'", "currency: 'usd'");
    try {
      const { diff: d } = await diff(dir);
      expect(d.symbols.changed).toEqual(['src/gateways/StripeGateway.ts#StripeGateway', 'src/gateways/StripeGateway.ts#StripeGateway.charge']);
      expect(d.symbols.added).toEqual([]);
      expect(d.symbols.removed).toEqual([]);
      expect(d.edges).toEqual({ added: [], removed: [] });
      expect(d.empty).toBe(false);

      // V2c: --html leva o diff e as rotas tocadas para o visualizador
      const html = path.join(dir, '..', path.basename(dir) + '-mapa.html');
      try {
        expect(await main(['diff', dir, '--base', 'HEAD', '--html', html], { out: () => {}, err: () => {}, env: {} })).toBe(0);
        const scripts = fs.readFileSync(html, 'utf8').split('<script>').slice(1).map((s) => s.slice(0, s.indexOf('</script>')));
        const overlay = new Function(`${scripts[4]}; return OVERLAY;`)();
        expect(overlay.diff.diff.symbols.changed).toContain('src/gateways/StripeGateway.ts#StripeGateway.charge');
        expect(overlay.diff.routes.affected.map((a: { id: string }) => a.id)).toEqual(['POST /checkout']);
        expect(overlay.chaos).toBeUndefined();
        expect(() => new Function(scripts[5]!)).not.toThrow();
      } finally {
        fs.rmSync(html, { force: true });
      }
    } finally {
      reset();
    }
  });

  it('renomear sem mexer no corpo é renamed, não remoção + adição; a chamada que ficou órfã aparece nas arestas', async () => {
    edit('src/repositories/OrderRepository.ts', 'async findById(', 'async getById(');
    try {
      const { diff: d } = await diff(dir);
      expect(d.symbols.renamed).toEqual([{ from: 'src/repositories/OrderRepository.ts#OrderRepository.findById', to: 'src/repositories/OrderRepository.ts#OrderRepository.getById' }]);
      expect(d.symbols.added).toEqual([]);
      expect(d.symbols.removed).toEqual([]);
      // CheckoutService.find ainda chama findById, que não existe mais
      expect(d.edges.removed).toContain('src/services/CheckoutService.ts#CheckoutService.find -calls-> src/repositories/OrderRepository.ts#OrderRepository.getById');
    } finally {
      reset();
    }
  });

  it('montagem no topo do arquivo (container.ts) aparece em topChanged; arquivo novo e símbolo novo também', async () => {
    edit('src/container.ts', "process.env.STRIPE_KEY ?? ''", "process.env.STRIPE_SECRET ?? ''");
    fs.writeFileSync(file('src/health.ts'), 'export function health() {\n  return { ok: true };\n}\n');
    try {
      const { diff: d, changedFiles } = await diff(dir);
      expect(d.files.topChanged).toEqual(['src/container.ts']);
      expect(d.files.added).toEqual(['src/health.ts']);
      expect(d.symbols.added).toEqual(['src/health.ts#health']);
      expect(changedFiles).toEqual(['src/container.ts', 'src/health.ts']);
    } finally {
      reset();
      fs.rmSync(file('src/health.ts'), { force: true });
    }
  });

  it('fora de um repositório git, ou com ref inexistente: erro de ambiente (exit 2)', async () => {
    const err: string[] = [];
    const io = { out: () => {}, err: (l: string) => err.push(l), env: {} };
    expect(await main(['diff', dir, '--base', 'nao-existe'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/ref "nao-existe" não existe/);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-nogit-'));
    try {
      expect(await main(['diff', plain, '--base', 'HEAD'], io)).toBe(2);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('E5/5d — shieldepy chaos --base: só as rotas que o PR tocou', () => {
  let dir: string;
  const edit = (rel: string, from: string, to: string) => {
    const full = path.join(dir, rel);
    const text = fs.readFileSync(full, 'utf8');
    expect(text).toContain(from);
    fs.writeFileSync(full, text.replace(from, to));
  };
  const reset = () => {
    execFileSync('git', ['checkout', '--quiet', '--', '.'], { cwd: dir });
    fs.rmSync(path.join(dir, '.shieldepy'), { recursive: true, force: true });
  };
  async function chaos() {
    const out: string[] = [];
    const code = await main(['chaos', dir, '--base', 'HEAD', '--no-run', '--offline', '--json'], { out: (l) => out.push(l), err: () => {}, env: {} });
    const r = JSON.parse(out.join('\n'));
    return { code, scope: r.scope, specs: r.specs.map((s: { hypothesisId: string }) => s.hypothesisId) as string[] };
  }

  beforeAll(() => {
    dir = gitCopy();
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('só comentário e linhas em branco: nenhuma rota tocada, nenhum teste, exit 0', async () => {
    edit('src/services/CheckoutService.ts', 'export class CheckoutService', '/** doc nova */\n\nexport class CheckoutService');
    try {
      const r = await chaos();
      expect(r.code).toBe(0);
      expect(r.scope).toMatchObject({ tested: [], affected: [] });
      expect(r.scope.untouched.sort()).toEqual(['GET /orders/:id', 'POST /checkout']);
      expect(r.specs).toEqual([]);
    } finally {
      reset();
    }
  });

  it('corpo do StripeGateway.charge: só POST /checkout entra, com o motivo; GET /orders/:id fica de fora', async () => {
    edit('src/gateways/StripeGateway.ts', "currency: 'brl'", "currency: 'usd'");
    try {
      const r = await chaos();
      expect(r.scope.tested).toEqual(['POST /checkout']);
      expect(r.scope.affected[0].why).toEqual(['código no caminho mudou: src/gateways/StripeGateway.ts#StripeGateway.charge']);
      expect(r.scope.untouched).toEqual(['GET /orders/:id']);
      expect(r.specs.length).toBeGreaterThan(0);
      expect(r.specs.every((id) => id.startsWith('POST /checkout__'))).toBe(true);
    } finally {
      reset();
    }
  });

  it('corpo do OrderRepository.findById: só GET /orders/:id (que não tem falha testável, então nenhum teste)', async () => {
    edit('src/repositories/OrderRepository.ts', 'WHERE id = $1', 'WHERE id = $1 LIMIT 1');
    try {
      const r = await chaos();
      expect(r.scope.tested).toEqual(['GET /orders/:id']);
      expect(r.scope.untouched).toEqual(['POST /checkout']);
      expect(r.specs).toEqual([]);
    } finally {
      reset();
    }
  });

  it('package.json mudou: todas as rotas, com o motivo', async () => {
    edit('package.json', '"private": true', '"private": true, "version": "0.0.2"');
    try {
      const r = await chaos();
      expect(r.scope.all).toMatch(/mudou package\.json/);
      expect(r.scope.tested.sort()).toEqual(['GET /orders/:id', 'POST /checkout']);
    } finally {
      reset();
    }
  });
});
