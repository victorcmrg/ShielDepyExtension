import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GraphManager } from '../src/graph/GraphManager';
import { createGraph, Fixture, hasEdge, indexFile, symbolId } from './helpers/graph';

describe('Etapa 0 — infraestrutura (teste de fumaça)', () => {
  let graph: GraphManager;
  let fx: Fixture;

  beforeAll(async () => {
    graph = await createGraph();
  });

  afterEach(() => fx?.cleanup());

  it('carrega o Tree-sitter real e monta a aresta a → calls → b', async () => {
    fx = new Fixture();
    const uri = await indexFile(graph, fx, 'smoke.ts', 'function a() { b(); }\nfunction b() {}\n');

    expect(graph.isReady).toBe(true);
    const a = symbolId(graph, 'a', uri);
    const b = symbolId(graph, 'b', uri);
    expect(hasEdge(graph, a, b, 'calls')).toBe(true);
  });
});
