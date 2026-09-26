import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GraphManager } from '../src/graph/GraphManager';
import { createGraph, Fixture, hasEdge, indexFile, nodeAttributes, symbolId } from './helpers/graph';

describe('Etapa 1 — grafo correto', () => {
  let graph: GraphManager;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('1.1 — `import "./b"` liga ao nó REAL de b.ts (não a um fantasma sem extensão)', async () => {
    const b = await indexFile(graph, fx, 'b.ts', 'export function b() {}\n');
    const a = await indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");

    expect(hasEdge(graph, a.toString(), b.toString(), 'imports')).toBe(true);
    expect(nodeAttributes(graph, b.toString())?.external).toBeFalsy();
    expect(hasEdge(graph, symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
  });

  it('1.2 — reparsear o CSS não apaga o vínculo HTML → CSS', async () => {
    await indexFile(graph, fx, 'style.css', '.ok { color: red; }\n');
    const html = await indexFile(
      graph,
      fx,
      'index.html',
      '<link rel="stylesheet" href="style.css">\n<div class="ok missing"></div>\n'
    );
    const css = fx.uri('style.css');

    expect(graph.findUnresolvedHtmlReferences(html.toString()).map((r) => r.token)).toEqual(['.missing']);

    // Usuário edita o CSS:
    await indexFile(graph, fx, 'style.css', '.ok { color: blue; }\n');

    expect(hasEdge(graph, html.toString(), css.toString(), 'imports')).toBe(true);
    expect(graph.findUnresolvedHtmlReferences(html.toString()).map((r) => r.token)).toEqual(['.missing']);
  });

  it('1.2 — ordem de indexação HTML antes do CSS também mantém o vínculo', async () => {
    fx.write('style.css', '.ok {}\n');
    const html = await indexFile(graph, fx, 'index.html', '<link href="style.css">\n<p class="nope"></p>\n');
    await indexFile(graph, fx, 'style.css', '.ok {}\n');

    expect(graph.findUnresolvedHtmlReferences(html.toString()).map((r) => r.token)).toEqual(['.nope']);
  });

  it('1.3 — chamada entre arquivos é ligada mesmo indexando o chamador ANTES do chamado', async () => {
    fx.write('b.ts', "import { a } from './a';\nexport function b() { a(); }\n");
    const a = await indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    const b = await indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");

    expect(hasEdge(graph, symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
    expect(hasEdge(graph, symbolId(graph, 'b', b), symbolId(graph, 'a', a), 'calls')).toBe(true);
  });

  it('1.3 — editar b.ts deslocando linhas (id do símbolo muda) mantém as arestas vindas de a.ts', async () => {
    const b = await indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");
    const a = await indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    await indexFile(graph, fx, 'b.ts', "\n\n\nimport { a } from './a';\nexport function b() { a(); }\n");

    expect(hasEdge(graph, symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
    expect(hasEdge(graph, symbolId(graph, 'b', b), symbolId(graph, 'a', a), 'calls')).toBe(true);
  });

  it('1.3 — import escrito ANTES de o arquivo existir é ligado quando o arquivo é criado', async () => {
    const a = await indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    expect(graph.getImpactSubgraph(a.toString(), 1).edges.some((e) => e.attributes.type === 'imports')).toBe(false);

    const b = await indexFile(graph, fx, 'b.ts', 'export function b() {}\n');

    expect(hasEdge(graph, a.toString(), b.toString(), 'imports')).toBe(true);
    expect(hasEdge(graph, symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
  });

  it('1.4 — chamada dentro de método sai do MÉTODO, não da classe', async () => {
    const uri = await indexFile(graph, fx, 'c.ts', 'class C {\n  m1() {\n    this.m2();\n  }\n  m2() {}\n}\n');

    expect(hasEdge(graph, symbolId(graph, 'm1', uri), symbolId(graph, 'm2', uri), 'calls')).toBe(true);
    expect(hasEdge(graph, symbolId(graph, 'C', uri), symbolId(graph, 'm2', uri), 'calls')).toBe(false);
  });

  it('1.5 — arrow function e function expression viram símbolos com arestas de chamada', async () => {
    const uri = await indexFile(
      graph,
      fx,
      'f.ts',
      'const f = () => g();\nconst h = function () {\n  g();\n};\nfunction g() {}\n'
    );

    const g = symbolId(graph, 'g', uri);
    expect(hasEdge(graph, symbolId(graph, 'f', uri), g, 'calls')).toBe(true);
    expect(hasEdge(graph, symbolId(graph, 'h', uri), g, 'calls')).toBe(true);
  });

  it('1.6 — CICLO ENTRE ARQUIVOS a.ts → b.ts → a.ts é detectado (teste-chave)', async () => {
    const a = await indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    const b = await indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");

    const cycle = graph.findCycleThrough(symbolId(graph, 'a', a));
    expect(cycle).not.toBeNull();
    expect(cycle!.map((id) => graph.getLabel(id))).toEqual(['a', 'b', 'a']);
    expect(cycle).toContain(symbolId(graph, 'b', b));
  });

  it('1.6 — cadeia longa (15.000 saltos) não estoura a pilha e acha o ciclo', () => {
    const g = (graph as any).graph;
    const N = 15000;
    for (let i = 0; i < N; i++) g.addNode(`n${i}`, { kind: 'function', name: `n${i}` });
    for (let i = 0; i < N; i++) g.addEdge(`n${i}`, `n${(i + 1) % N}`, { type: 'calls' });

    let result: string[] | null = null;
    expect(() => {
      result = graph.findCycleThrough('n0');
    }).not.toThrow();
    expect(result).not.toBeNull();
    expect(result!.length).toBe(N + 1);
  });
});
