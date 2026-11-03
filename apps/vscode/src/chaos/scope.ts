import { execFile } from 'node:child_process';

/** A base do "só o que mudou", na ordem de preferência. */
export const BASE_REFS = ['origin/main', 'origin/master', 'main', 'master'];

/** O commit de um ref, ou undefined se ele não existe (ou a pasta não é git). */
function commitOf(root: string, ref: string): Promise<string | undefined> {
  return new Promise((resolve) =>
    execFile('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root }, (err, stdout) =>
      resolve(err ? undefined : stdout.trim() || undefined)
    )
  );
}

/**
 * A base para o escopo "só o que mudou desde…": o primeiro ref de `BASE_REFS` que existe, desde que o
 * HEAD não seja esse mesmo commit. Na própria main (ou numa branch sem commit novo) não há diferença,
 * e oferecer o escopo dava 0 rotas testadas e um "nada barrou" que parece verde. Nesse caso, e quando
 * a pasta não é git ou não tem main, devolve undefined (o caos roda em todas as rotas sensíveis).
 */
export async function diffBase(root: string): Promise<string | undefined> {
  for (const ref of BASE_REFS) {
    const base = await commitOf(root, ref);
    if (!base) continue;
    const head = await commitOf(root, 'HEAD');
    return head === base ? undefined : ref;
  }
  return undefined;
}
