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

  it('argumentos inválidos → código 2 com o uso', async () => {
    expect((await run('report', 'x', '--fail-on', 'grave')).code).toBe(2);
    expect((await run('voar')).code).toBe(2);
    expect((await run('report', '/nao/existe')).err).toMatch(/erro:/);
    expect(parseArgs(['explain', 'p', '--json'])).toEqual({ command: 'explain', target: 'p', json: true, pg: false });
  });
});
