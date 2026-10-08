import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, type CodeGraph } from '../../src';
import { createGraph, Fixture, indexFile } from '../helpers';

/** Ids e arestas do mapa, sem posição: é o que o diff entre duas versões compara. */
function shape(graph: CodeGraph, dir: string) {
  const system = buildSystemGraph(graph, [], dir);
  return {
    nodes: system.nodes.map((n) => n.id).sort(),
    edges: system.edges.map((e) => `${e.source} -${e.type}-> ${e.target}`).sort(),
  };
}

const SERVICE = `import { Repo } from './repo';
export class OrderService {
  constructor(private repo: Repo) {}
  create(x: number) { return this.repo.save(x); }
  cancel(id: number) { return this.repo.remove(id); }
}
`;
const REPO = `export class Repo {
  save(x: number) { return x; }
  remove(id: number) { return id; }
}
export class Audit {
  save(x: number) { return x; }
}
`;

describe('E5/5a — ids estáveis', () => {
  let graph: CodeGraph;
  let fx: Fixture;
  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });
  afterEach(() => fx.cleanup());

  it('o id é arquivo#Contêiner.nome, sem a linha; a linha fica em startLine', () => {
    indexFile(graph, fx, 'repo.ts', REPO);
    indexFile(graph, fx, 'service.ts', SERVICE);
    const { nodes } = shape(graph, fx.dir);
    // dois `save` no mesmo arquivo, em classes diferentes: o contêiner separa, sem sufixo
    expect(nodes).toEqual(expect.arrayContaining(['repo.ts#Repo.save', 'repo.ts#Audit.save', 'service.ts#OrderService.create']));
    expect(nodes.some((id) => /:\d+$/.test(id))).toBe(false);
    const system = buildSystemGraph(graph, [], fx.dir);
    expect(system.nodes.find((n) => n.id === 'service.ts#OrderService.cancel')?.startLine).toBe(4);
  });

  it('inserir linhas e comentários acima não muda nenhum id nem aresta', () => {
    indexFile(graph, fx, 'repo.ts', REPO);
    indexFile(graph, fx, 'service.ts', SERVICE);
    const before = shape(graph, fx.dir);
    indexFile(graph, fx, 'service.ts', `// cabeçalho novo\n\n/** doc */\n${SERVICE}`);
    indexFile(graph, fx, 'repo.ts', `\n\n${REPO}`);
    expect(shape(graph, fx.dir)).toEqual(before);
  });

  it('nomes repetidos no mesmo arquivo ganham ~2, ~3 pela ordem; os de antes não mudam', () => {
    const routes = (extra: string) => `import express from 'express';
const app = express();
app.get('/a', (req, res) => { res.send('1'); });
app.get('/a', (req, res) => { res.send('2'); });
${extra}`;
    indexFile(graph, fx, 'app.ts', routes(''));
    expect(shape(graph, fx.dir).nodes.filter((id) => id.startsWith('app.ts#'))).toEqual(["app.ts#app.get('/a')", "app.ts#app.get('/a')~2"]);
    // um terceiro no fim não renumera os anteriores
    indexFile(graph, fx, 'app.ts', routes(`app.get('/a', (req, res) => { res.send('3'); });\n`));
    expect(shape(graph, fx.dir).nodes.filter((id) => id.startsWith('app.ts#'))).toEqual([
      "app.ts#app.get('/a')",
      "app.ts#app.get('/a')~2",
      "app.ts#app.get('/a')~3",
    ]);
  });
});
