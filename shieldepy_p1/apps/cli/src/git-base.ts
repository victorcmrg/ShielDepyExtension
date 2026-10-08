// O mapa "de antes" de um PR (E5): a mesma pasta, no commit base, num `git worktree` temporário.
// Só lê código (Tree-sitter), então não precisa de `npm install`. A base é o merge-base entre o
// ref e o HEAD, como num PR: o que a `main` ganhou depois que a branch saiu não conta como mudança.

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new GitBaseError(`git ${args.join(' ')}: ${(e.stderr || e.message).trim()}`);
  }
}

/** Erro de ambiente (fora de um repositório git, ref inexistente): vira exit 2. */
export class GitBaseError extends Error {}

export interface BaseInfo {
  /** Commit usado como base (merge-base entre o ref e o HEAD). */
  commit: string;
  /** Arquivos que mudaram na pasta desde a base, relativos a ela (com `/`), inclusive os não commitados. */
  changedFiles: string[];
}

/** Resolve a base e lista o que mudou na pasta (commitado, não commitado e arquivo novo). */
export async function baseInfo(dir: string, ref: string): Promise<BaseInfo & { top: string; rel: string }> {
  const abs = path.resolve(dir);
  const top = await git(abs, ['rev-parse', '--show-toplevel']);
  const rel = path.relative(top, abs).split(path.sep).join('/');
  await git(top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => {
    throw new GitBaseError(`ref "${ref}" não existe (no CI, faça checkout com fetch-depth: 0)`);
  });
  const commit = await git(top, ['merge-base', ref, 'HEAD']).catch(() => git(top, ['rev-parse', `${ref}^{commit}`]));
  const scope = rel || '.';
  const tracked = await git(top, ['diff', '--name-only', commit, '--', scope]);
  const untracked = await git(top, ['ls-files', '--others', '--exclude-standard', '--', scope]);
  const prefix = rel ? `${rel}/` : '';
  const changedFiles = [...new Set([...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean))]
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f))
    .sort();
  return { commit, changedFiles, top, rel };
}

/** Roda `fn` com a pasta como ela era na base. O worktree é apagado no fim, dê certo ou não. */
export async function withBaseCheckout<T>(dir: string, ref: string, fn: (baseDir: string, info: BaseInfo) => Promise<T>): Promise<T> {
  const info = await baseInfo(dir, ref);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'shieldepy-base-'));
  const worktree = path.join(tmp, 'wt');
  await git(info.top, ['worktree', 'add', '--detach', '--quiet', worktree, info.commit]);
  try {
    return await fn(path.join(worktree, ...info.rel.split('/').filter(Boolean)), { commit: info.commit, changedFiles: info.changedFiles });
  } finally {
    await git(info.top, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
    await rm(tmp, { recursive: true, force: true });
  }
}
