import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toFileId, type CodeGraph } from '../src/index';
import { createGraph, Fixture, indexFile, symbolId } from './helpers';

describe('CodeGraph — grafo estrutural correto (etapa 1 do plano original)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('fumaça: carrega o Tree-sitter real e monta a aresta a → calls → b', () => {
    const file = indexFile(graph, fx, 'smoke.ts', 'function a() { b(); }\nfunction b() {}\n');

    expect(graph.isReady).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'a', file), symbolId(graph, 'b', file), 'calls')).toBe(true);
  });

  it('1.1 — `import "./b"` liga ao nó REAL de b.ts (não a um fantasma sem extensão)', () => {
    const b = indexFile(graph, fx, 'b.ts', 'export function b() {}\n');
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");

    expect(graph.hasEdge(a, b, 'imports')).toBe(true);
    const attrs = graph.nodeAttributes(b);
    expect(attrs?.kind === 'file' && attrs.external).toBeFalsy();
    expect(graph.hasEdge(symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
  });

  it('1.2 — reparsear o CSS não apaga o vínculo HTML → CSS', () => {
    const css = indexFile(graph, fx, 'style.css', '.ok { color: red; }\n');
    const html = indexFile(graph, fx, 'index.html', '<link rel="stylesheet" href="style.css">\n<div class="ok missing"></div>\n');

    expect(graph.findUnresolvedHtmlReferences(html).map((r) => r.token)).toEqual(['.missing']);

    indexFile(graph, fx, 'style.css', '.ok { color: blue; }\n');

    expect(graph.hasEdge(html, css, 'imports')).toBe(true);
    expect(graph.findUnresolvedHtmlReferences(html).map((r) => r.token)).toEqual(['.missing']);
  });

  it('1.2 — ordem de indexação HTML antes do CSS também mantém o vínculo', () => {
    fx.write('style.css', '.ok {}\n');
    const html = indexFile(graph, fx, 'index.html', '<link href="style.css">\n<p class="nope"></p>\n');
    indexFile(graph, fx, 'style.css', '.ok {}\n');

    expect(graph.findUnresolvedHtmlReferences(html).map((r) => r.token)).toEqual(['.nope']);
  });

  it('1.3 — chamada entre arquivos é ligada mesmo indexando o chamador ANTES do chamado', () => {
    fx.write('b.ts', "import { a } from './a';\nexport function b() { a(); }\n");
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    const b = indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");

    expect(graph.hasEdge(symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'b', b), symbolId(graph, 'a', a), 'calls')).toBe(true);
  });

  it('1.3 — editar b.ts deslocando linhas (id do símbolo muda) mantém as arestas vindas de a.ts', () => {
    const b = indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    indexFile(graph, fx, 'b.ts', "\n\n\nimport { a } from './a';\nexport function b() { a(); }\n");

    expect(graph.hasEdge(symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'b', b), symbolId(graph, 'a', a), 'calls')).toBe(true);
  });

  it('1.3 — import escrito ANTES de o arquivo existir é ligado quando o arquivo é criado', () => {
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    expect(graph.getImpactSubgraph(a, 1).edges.some((e) => e.attributes.type === 'imports')).toBe(false);

    const b = indexFile(graph, fx, 'b.ts', 'export function b() {}\n');

    expect(graph.hasEdge(a, b, 'imports')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'a', a), symbolId(graph, 'b', b), 'calls')).toBe(true);
  });

  it('1.4 — chamada dentro de método sai do MÉTODO, não da classe', () => {
    const file = indexFile(graph, fx, 'c.ts', 'class C {\n  m1() {\n    this.m2();\n  }\n  m2() {}\n}\n');

    expect(graph.hasEdge(symbolId(graph, 'm1', file), symbolId(graph, 'm2', file), 'calls')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'C', file), symbolId(graph, 'm2', file), 'calls')).toBe(false);
  });

  it('1.5 — arrow function e function expression viram símbolos com arestas de chamada', () => {
    const file = indexFile(graph, fx, 'f.ts', 'const f = () => g();\nconst h = function () {\n  g();\n};\nfunction g() {}\n');

    const g = symbolId(graph, 'g', file);
    expect(graph.hasEdge(symbolId(graph, 'f', file), g, 'calls')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'h', file), g, 'calls')).toBe(true);
  });

  it('1.6 — CICLO ENTRE ARQUIVOS a.ts → b.ts → a.ts é detectado (teste-chave)', () => {
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    const b = indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");

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

describe('CodeGraph — correções novas', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('2.2 — cyclesInFile devolve cada símbolo do arquivo que está num ciclo, com rótulos', () => {
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\nexport function solto() {}\n");
    indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");

    const cycles = graph.cyclesInFile(a);
    expect(cycles.map((c) => c.name)).toEqual(['a']);
    expect(cycles[0]!.labels).toEqual(['a', 'b', 'a']);
    expect(cycles[0]!.startLine).toBe(1);
  });

  it('2.3 — fork() simula um conteúdo proposto sem tocar no grafo original', () => {
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    indexFile(graph, fx, 'b.ts', 'export function b() {}\n');
    expect(graph.cyclesInFile(a)).toEqual([]);

    const sim = graph.fork();
    sim.updateFile(fx.path('b.ts'), "import { a } from './a';\nexport function b() { a(); }\n");

    expect(sim.cyclesInFile(a).length).toBe(1);
    expect(graph.cyclesInFile(a)).toEqual([]); // o real continua refletindo o arquivo real
  });

  it('onParsed entrega a árvore de cada arquivo de código (um parse só pra grafo + regras)', () => {
    const seen: string[] = [];
    graph.onParsed(({ id, root }) => seen.push(`${id}:${root.type}`));
    const a = indexFile(graph, fx, 'a.ts', 'export const x = 1;\n');
    indexFile(graph, fx, 'style.css', '.x {}\n');

    expect(seen).toEqual([`${a}:program`]);
  });

  it('CSS: cor hexadecimal e comentário não viram seletor', () => {
    const css = indexFile(
      graph,
      fx,
      's.css',
      '/* .comentado {} */\n.real { color: #fff; background: #abcdef; }\n@media (max-width: 1px) { .dentro { color: red; } }\n'
    );

    const names = graph.ownedSymbols(css).map((id) => graph.getLabel(id)).sort();
    expect(names).toEqual(['.dentro', '.real']);
  });

  it('toFileId normaliza barras e a letra do drive', () => {
    if (process.platform === 'win32') {
      expect(toFileId('C:\\proj\\a.ts')).toBe('c:/proj/a.ts');
      expect(toFileId('c:\\proj\\a.ts')).toBe(toFileId('C:/proj/a.ts'));
    } else {
      expect(toFileId('/proj/./a.ts')).toBe('/proj/a.ts');
    }
  });

  it('removeFile tira o arquivo e seus símbolos do grafo', () => {
    const a = indexFile(graph, fx, 'a.ts', 'export function a() {}\n');
    expect(graph.ownedSymbols(a).length).toBe(1);
    graph.removeFile(fx.path('a.ts'));
    expect(graph.hasFile(a)).toBe(false);
    expect(graph.stats.nodes).toBe(0);
  });
});
