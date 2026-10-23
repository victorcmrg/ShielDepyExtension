import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { indexFiles, listSourceFiles, looksGenerated, silentHost, type CodeGraph } from '../src/index';
import { createGraph, Fixture, indexFile } from './helpers';

/** Id do método `name` da classe `container` no arquivo. */
function methodId(graph: CodeGraph, container: string, name: string, fileId: string): string {
  const id = graph.ownedSymbols(fileId).find((s) => {
    const a = graph.nodeAttributes(s);
    return a?.kind === 'method' && a.container === container && a.name === name;
  });
  if (!id) throw new Error(`método ${container}.${name} não encontrado`);
  return id;
}

// Achados de rodar a extensão no próprio ShielDepy (Q1–Q3 do plano): o que um projeto real mostrou.
describe('Q — o que o projeto real mostrou', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('Q2: this.campo.set() (Map, Set ou objeto de pacote) não liga ao set() da própria classe (nem vira ciclo)', () => {
    // o FindingsManager.ts da extensão: `diagnostics` vem de uma chamada a pacote, sem tipo declarado
    const f = indexFile(
      graph,
      fx,
      'findings.ts',
      [
        "import * as vscode from 'vscode';",
        'export class FindingsManager {',
        '  private readonly store = new Map<string, number[]>();',
        '  private readonly seen: Set<string> = new Set();',
        "  private readonly diagnostics = vscode.languages.createDiagnosticCollection('x');",
        '  set(id: string, list: number[]): void { this.publish(id, list); }',
        '  private publish(id: string, list: number[]): void { this.store.set(id, list); this.seen.add(id); this.diagnostics.set(id, []); }',
        '  add(id: string): void {}',
        '}',
        '',
      ].join('\n')
    );
    const publish = methodId(graph, 'FindingsManager', 'publish', f);
    expect(graph.hasEdge(publish, methodId(graph, 'FindingsManager', 'set', f), 'calls')).toBe(false);
    expect(graph.hasEdge(publish, methodId(graph, 'FindingsManager', 'add', f), 'calls')).toBe(false);
    // o hasEdge respeita a direção: set → publish existe, publish → set não
    expect(graph.hasEdge(methodId(graph, 'FindingsManager', 'set', f), publish, 'calls')).toBe(true);
    expect(graph.cyclesInFile(f)).toEqual([]);
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0 });
  });

  it('Q2: um ciclo que só fecha por uma ligação por nome (heurística) não é acusado', () => {
    const f = indexFile(graph, fx, 'loop.js', 'export function go(h) { h.run(); }\nexport function run() { go(); }\n');
    expect(graph.fileCoverage(f).callsHeuristic).toBeGreaterThan(0); // a ligação existe, marcada
    expect(graph.cyclesInFile(f)).toEqual([]);
  });

  it('Q3: recursão mútua no mesmo arquivo sai marcada como recursão; entre arquivos, não', () => {
    const rec = indexFile(
      graph,
      fx,
      'rec.ts',
      'export function even(n: number): boolean { return n === 0 || odd(n - 1); }\nexport function odd(n: number): boolean { return n !== 0 && even(n - 1); }\n'
    );
    const a = indexFile(graph, fx, 'a.ts', "import { b } from './b';\nexport function a() { b(); }\n");
    indexFile(graph, fx, 'b.ts', "import { a } from './a';\nexport function b() { a(); }\n");
    expect(graph.cyclesInFile(rec).map((c) => c.recursion)).toEqual([true, true]);
    expect(graph.cyclesInFile(a).map((c) => c.recursion)).toEqual([false]);
  });

  it('Q1: arquivo minificado ou de bundle não entra no mapa (nome ou conteúdo)', () => {
    const minified = `!function(e){${'var a=1;'.repeat(400)}}();`;
    expect(looksGenerated('lib/cytoscape.min.js', 'x')).toBe(true);
    expect(looksGenerated('static/app.bundle.js', 'x')).toBe(true);
    expect(looksGenerated('src/vendor-lib.js', minified)).toBe(true);
    expect(looksGenerated('src/app.ts', 'export const a = 1;\n'.repeat(50))).toBe(false);
    // uma linha longa (base64, SVG embutido) num arquivo escrito à mão não o tira do mapa
    const handWritten = `export const logo = '${'A'.repeat(3000)}';\n${'export function f() { return 1; }\n'.repeat(200)}`;
    expect(looksGenerated('src/logo.ts', handWritten)).toBe(false);

    const min = indexFile(graph, fx, 'media/lib.js', minified);
    expect(graph.files()).not.toContain(min);
    // já indexado e virou minificado (ex.: um build sobrescreveu): sai do mapa
    const src = indexFile(graph, fx, 'src/x.js', 'export function x() {}\n');
    expect(graph.files()).toContain(src);
    graph.updateFile(fx.path('src/x.js'), minified);
    expect(graph.files()).not.toContain(src);
  });

  it('Q1: pastas de terceiros e de saída de build não são varridas', async () => {
    for (const rel of ['src/app.ts', 'vendor/lib.js', 'build/out.js', 'coverage/lcov.js', '.next/server.js', 'bower_components/x.js']) {
      fx.write(rel, 'export const a = 1;\n');
    }
    const files = (await listSourceFiles(fx.dir)).map((f) => path.relative(fx.dir, f).split(path.sep).join('/'));
    expect(files).toEqual(['src/app.ts']);
    await indexFiles(graph, [fx.path('vendor/lib.js')], silentHost);
    expect(graph.files()).toEqual([]);
  });
});
