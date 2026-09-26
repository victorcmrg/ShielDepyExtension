import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveImport } from '../src/graph/resolveImport';

const root = path.resolve('/proj/src');
const p = (...parts: string[]) => path.join(root, ...parts);
const existsIn = (...files: string[]) => {
  const set = new Set(files.map((f) => path.normalize(f)));
  return (candidate: string) => set.has(path.normalize(candidate));
};

describe('1.1 — resolveImport (função pura)', () => {
  const from = p('a.ts');

  it.each([
    ['sem extensão → .ts', './b', [p('b.ts')], p('b.ts')],
    ['sem extensão → .tsx', './b', [p('b.tsx')], p('b.tsx')],
    ['sem extensão → .js', './b', [p('b.js')], p('b.js')],
    ['diretório → index.ts', './lib', [p('lib', 'index.ts')], p('lib', 'index.ts')],
    ['ESM ".js" apontando pra fonte .ts', './b.js', [p('b.ts')], p('b.ts')],
    ['".js" que existe de verdade', './b.js', [p('b.js')], p('b.js')],
    ['caminho exato com extensão', './style.css', [p('style.css')], p('style.css')],
    ['subindo diretório', '../shared/util', [path.resolve('/proj/shared/util.ts')], path.resolve('/proj/shared/util.ts')],
    ['prefere .ts a index', './b', [p('b.ts'), p('b', 'index.ts')], p('b.ts')],
  ])('%s', (_label, spec, files, expected) => {
    expect(resolveImport(from, spec, existsIn(...files))).toBe(path.normalize(expected));
  });

  it('pacote (não relativo) → undefined', () => {
    expect(resolveImport(from, 'react', existsIn())).toBeUndefined();
  });

  it('arquivo inexistente → undefined', () => {
    expect(resolveImport(from, './nao-existe', existsIn(p('b.ts')))).toBeUndefined();
  });
});
