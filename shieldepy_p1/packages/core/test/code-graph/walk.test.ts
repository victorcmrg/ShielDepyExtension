import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSystemGraph, indexFiles, listSourceFiles, silentHost, walkSourceTree } from '../../src';
import { createGraph, REPO_ROOT } from '../helpers';

describe('walkSourceTree', () => {
  it('não desce nas pastas ignoradas e devolve caminhos relativos ordenados', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shieldepy-walk-'));
    try {
      for (const f of ['src/b.ts', 'src/a/x.ts', 'z.ts', 'node_modules/pkg/i.js', '.shieldepy/chaos-tests/t.spec.ts', '.vscode-test/vscode/out/main.js', 'dist/out.js', 'src/node_modules/y.ts']) {
        fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
        fs.writeFileSync(path.join(root, f), '');
      }
      expect(walkSourceTree(root).map((p) => p.split(path.sep).join('/'))).toEqual(['src/a/x.ts', 'src/b.ts', 'z.ts']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('a raiz inexistente é erro (não uma lista vazia em silêncio)', () => {
    expect(() => walkSourceTree(path.join(os.tmpdir(), 'shieldepy-nao-existe-123'))).toThrow();
  });
});

describe('o mapa não depende da ordem de indexação', () => {
  it('checkout-express: mesma ordem, invertida e embaralhada dão o mesmo hash (instância exportada religa quem a importa)', async () => {
    const dir = path.join(REPO_ROOT, 'examples', 'checkout-express');
    const files = await listSourceFiles(dir);
    const hashes = new Set<string>();
    for (const order of [files, [...files].reverse(), [...files].sort((a, b) => (a.length % 7) - (b.length % 7) || a.localeCompare(b))]) {
      const graph = await createGraph();
      await indexFiles(graph, order, silentHost);
      const system = buildSystemGraph(graph, [], dir);
      expect(system.stats).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
      hashes.add(system.contentHash);
    }
    expect(hashes.size).toBe(1);
  });
});
