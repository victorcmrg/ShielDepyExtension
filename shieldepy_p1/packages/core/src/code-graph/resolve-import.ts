import * as path from 'node:path';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Resolve um especificador de import relativo (`./b`, `../lib`, `./b.js`) para o caminho do
 * arquivo real em disco, do mesmo jeito que o TypeScript/bundler faria: caminho exato,
 * extensões de código, `index.*` de diretório, e `.js` → `.ts` (imports ESM escritos com a
 * extensão de saída). Pacotes (não relativos) e arquivos inexistentes retornam `undefined`.
 * `exists` é injetado pra função ser pura e testável.
 */
export function resolveImport(fromFile: string, spec: string, exists: (candidate: string) => boolean): string | undefined {
  if (!spec.startsWith('.')) return undefined;

  const base = path.normalize(path.join(path.dirname(fromFile), spec));
  const candidates: string[] = [];

  const ext = path.extname(base);
  if (ext === '.js' || ext === '.jsx') {
    // Fonte TS primeiro: `./b.js` num projeto TS quase sempre aponta pra `b.ts`.
    const stem = base.slice(0, -ext.length);
    candidates.push(stem + (ext === '.js' ? '.ts' : '.tsx'));
  }
  candidates.push(base);
  for (const e of CODE_EXTENSIONS) candidates.push(base + e);
  for (const e of CODE_EXTENSIONS) candidates.push(path.join(base, 'index' + e));

  return candidates.find((c) => path.extname(c) !== '' && exists(c));
}
