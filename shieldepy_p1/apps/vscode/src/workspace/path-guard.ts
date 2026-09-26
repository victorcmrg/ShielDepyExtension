import * as path from 'node:path';

/**
 * Onde uma correção proposta pela IA pode ser escrita (item 3.4). O caminho vem do texto do
 * modelo — então é entrada não confiável: só vale se cair DENTRO de uma pasta do workspace.
 * `../../.ssh/config`, caminho absoluto fora do projeto, etc. → `undefined`.
 */
export function resolveInsideWorkspace(filePath: string, roots: string[]): string | undefined {
  const clean = filePath.trim().replace(/^["'`]|["'`]$/g, '');
  if (!clean || clean.includes('\0')) return undefined;

  const candidates = path.isAbsolute(clean) ? [path.resolve(clean)] : roots.map((r) => path.resolve(r, clean));
  for (const candidate of candidates) {
    for (const root of roots) {
      const rel = path.relative(path.resolve(root), candidate);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return candidate;
    }
  }
  return undefined;
}
