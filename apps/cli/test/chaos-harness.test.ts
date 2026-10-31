import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chaosHarness, defaultHarnessDir, linkHarness, packageDir } from '../src/chaos-harness';

const tmps: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-harness-'));
  tmps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Um pacote falso em `<dir>/node_modules/<name>`. */
function fakePackage(dir: string, name: string): string {
  const pkg = path.join(dir, 'node_modules', name);
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name }));
  fs.writeFileSync(path.join(pkg, 'vitest.mjs'), '');
  return pkg;
}

describe('MVP2 — o arnês de teste embutido', () => {
  it('empresta só o que falta no node_modules da raiz do projeto, achando o arnês subindo pelas pastas', () => {
    const project = tmp();
    fakePackage(project, 'msw');
    // os pacotes da CLI ficam içados na raiz do monorepo: o arnês é uma pasta abaixo
    const cli = tmp();
    const dirs = Object.fromEntries(['vitest', 'supertest', 'msw', '@electric-sql/pglite'].map((n) => [n, fakePackage(cli, n)]));
    const harnessDir = path.join(cli, 'apps', 'cli');
    fs.mkdirSync(harnessDir, { recursive: true });
    expect(packageDir('supertest', harnessDir)).toBe(dirs.supertest);
    // o pglite-socket não está no arnês: opcional, fica de fora (o --init pede para instalar)
    expect(chaosHarness(project, harnessDir)).toEqual({ borrowed: { vitest: dirs.vitest, supertest: dirs.supertest, '@electric-sql/pglite': dirs['@electric-sql/pglite'] } });
  });

  it('nada a emprestar quando o projeto tem tudo, sem arnês, ou quando o arnês não tem o essencial', () => {
    const full = tmp();
    for (const n of ['vitest', 'supertest', 'msw', '@electric-sql/pglite', '@electric-sql/pglite-socket']) fakePackage(full, n);
    expect(chaosHarness(full, tmp())).toBeUndefined();
    expect(chaosHarness(tmp(), undefined)).toBeUndefined();
    const partial = tmp();
    fakePackage(partial, 'vitest');
    expect(chaosHarness(tmp(), partial)).toBeUndefined();
  });

  it('os links ficam na pasta dos testes gerados, e apagá-la não toca nos pacotes da CLI', () => {
    const project = tmp();
    const cli = tmp();
    const dirs = Object.fromEntries(['vitest', 'supertest', 'msw'].map((n) => [n, fakePackage(cli, n)]));
    const harness = chaosHarness(project, cli)!;
    linkHarness(project, harness);
    linkHarness(project, harness); // de novo: substitui o link, sem erro
    const link = path.join(project, '.shieldepy', 'chaos-tests', 'node_modules', 'vitest');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(dirs.vitest!));
    expect(fs.existsSync(path.join(project, 'node_modules'))).toBe(false);
    fs.rmSync(path.join(project, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
    for (const dir of Object.values(dirs)) expect(fs.existsSync(path.join(dir, 'package.json'))).toBe(true);
  });

  it('na CLI, o arnês é a pasta do pacote @shieldepy/cli', () => {
    expect(path.basename(defaultHarnessDir()!)).toBe('cli');
    expect(fs.existsSync(path.join(defaultHarnessDir()!, 'package.json'))).toBe(true);
  });
});
