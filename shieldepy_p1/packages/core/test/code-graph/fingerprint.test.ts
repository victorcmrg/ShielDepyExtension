import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, type CodeGraph } from '../../src';
import { createGraph, Fixture, indexFile } from '../helpers';

const BASE = `import { db } from './db';
export const limit = 10;
export class Repo {
  save(x: number) {
    return db.insert(x + 1);
  }
}
export function helper(a: string) {
  return a.trim();
}
`;

describe('E5/5b — hash do corpo e do código de topo', () => {
  let graph: CodeGraph;
  let fx: Fixture;
  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });
  afterEach(() => fx.cleanup());

  /** id → bodyHash dos símbolos, e o topHash do arquivo. */
  function hashes(content: string) {
    indexFile(graph, fx, 'repo.ts', content);
    const nodes = buildSystemGraph(graph, [], fx.dir).nodes;
    return {
      body: Object.fromEntries(nodes.filter((n) => n.bodyHash).map((n) => [n.id, n.bodyHash])),
      top: nodes.find((n) => n.id === 'repo.ts')?.topHash,
    };
  }

  it('comentário, espaço, quebra de linha e linhas acima não mudam nada', () => {
    const before = hashes(BASE);
    expect(before.body['repo.ts#Repo.save']).toMatch(/^[0-9a-f]{16}$/);
    expect(before.top).toMatch(/^[0-9a-f]{16}$/);
    const noisy = `// novo cabeçalho\n\n${BASE.replace('return db.insert(x + 1);', '/* comentário */ return   db.insert( x+1 ); // fim')}`;
    expect(hashes(noisy)).toEqual(before);
  });

  it('mudar uma expressão muda só o hash daquele corpo (e o da classe que o contém)', () => {
    const before = hashes(BASE);
    const after = hashes(BASE.replace('x + 1', 'x - 1'));
    expect(after.body['repo.ts#Repo.save']).not.toBe(before.body['repo.ts#Repo.save']);
    expect(after.body['repo.ts#Repo']).not.toBe(before.body['repo.ts#Repo']);
    expect(after.body['repo.ts#helper']).toBe(before.body['repo.ts#helper']);
    expect(after.top).toBe(before.top);
  });

  it('renomear sem mexer no corpo mantém o hash (o diff vê como renomeação)', () => {
    const before = hashes(BASE);
    const after = hashes(BASE.replace('save(x: number)', 'persist(x: number)').replace('function helper', 'function tidy'));
    expect(after.body['repo.ts#Repo.persist']).toBe(before.body['repo.ts#Repo.save']);
    expect(after.body['repo.ts#tidy']).toBe(before.body['repo.ts#helper']);
  });

  it('o código de topo muda com import, constante exportada ou montagem, e não com o corpo das funções', () => {
    const before = hashes(BASE);
    expect(hashes(BASE.replace('limit = 10', 'limit = 20')).top).not.toBe(before.top);
    expect(hashes(BASE.replace("from './db'", "from './db2'")).top).not.toBe(before.top);
    expect(hashes(BASE.replace('a.trim()', 'a.trimEnd()')).top).toBe(before.top);
  });
});
