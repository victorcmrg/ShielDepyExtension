import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diffBase } from '../src/chaos/scope';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function repo(): { dir: string; git: (...args: string[]) => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-scope-'));
  dirs.push(dir);
  const git = (...args: string[]) => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  git('add', '.');
  git('commit', '-q', '-m', 'um');
  return { dir, git };
}

describe('o escopo "só o que mudou desde a main" do botão de caos', () => {
  it('na própria main não oferece o escopo (0 rotas e um "nada barrou" que parece verde)', async () => {
    const { dir } = repo();
    expect(await diffBase(dir)).toBeUndefined();
  });

  it('numa branch sem commit novo também não oferece', async () => {
    const { dir, git } = repo();
    git('switch', '-q', '-c', 'correcao');
    expect(await diffBase(dir)).toBeUndefined();
  });

  it('numa branch com commit novo oferece a main como base', async () => {
    const { dir, git } = repo();
    git('switch', '-q', '-c', 'correcao');
    fs.writeFileSync(path.join(dir, 'a.txt'), '2');
    git('commit', '-q', '-am', 'dois');
    expect(await diffBase(dir)).toBe('main');
  });

  it('fora de um repositório git não oferece', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-scope-'));
    dirs.push(dir);
    expect(await diffBase(dir)).toBeUndefined();
  });
});
