// Mede o mapa (grafo + topologia) em projetos reais de terceiros, fixados num commit (etapa M do
// plano). Clona cada um numa pasta FORA do repositório (padrão: <tmp>/shieldepy-mapa-reais), sem
// instalar dependências nem rodar nada deles: só lê o código. Um projeto por vez.
//
//   npm run mapa:reais                       → tabela no terminal
//   npm run mapa:reais -- --dir <pasta>      → onde clonar (reaproveita o que já estiver lá)
//   npm run mapa:reais -- --so realworld,nest → só esses
//   npm run mapa:reais -- --json <arquivo>   → também grava os números

import { mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSystemGraph, buildTopology, CodeGraph, indexFiles, listSourceFiles, silentHost } from '../packages/core/src/index';
import { defaultWasmDir } from '../packages/core/src/wasm-path';
import { arg, checkout, PROJECTS, type Project } from './real-projects';

interface Row {
  id: string;
  stack: string;
  files: number;
  seconds: number;
  proven: number;
  heuristic: number;
  unresolved: number;
  routes: number;
  sensitive: number;
  operations: number;
  skipped: number;
}

async function measure(p: Project, root: string): Promise<Row> {
  const started = Date.now();
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  const files = await listSourceFiles(root);
  await indexFiles(graph, files, silentHost);
  const system = buildSystemGraph(graph, [], root);
  const topology = buildTopology(graph, system, root);
  const s = graph.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  const row: Row = {
    id: p.id,
    stack: p.stack,
    files: graph.files().length,
    seconds: (Date.now() - started) / 1000,
    proven: internal === 0 ? 100 : (100 * s.callsResolved) / internal,
    heuristic: s.callsHeuristic,
    unresolved: s.callsUnresolved,
    routes: topology.stats.routes,
    sensitive: topology.stats.sensitiveRoutes,
    operations: topology.stats.operations,
    skipped: topology.stats.skippedRoutes,
  };
  graph.dispose();
  return row;
}

const dir = path.resolve(arg('--dir') ?? path.join(os.tmpdir(), 'shieldepy-mapa-reais'));
const only = arg('--so')?.split(',');
const selected = only ? PROJECTS.filter((p) => only.some((o) => p.id.includes(o))) : PROJECTS;
mkdirSync(dir, { recursive: true });
console.log(`Projetos em ${dir} (fora do repositório; nada é instalado nem executado).\n`);

const rows: Row[] = [];
for (const p of selected) {
  process.stdout.write(`- ${p.id} (${p.repo}@${p.commit.slice(0, 7)})… `);
  try {
    const root = checkout(p, dir);
    const row = await measure(p, root);
    rows.push(row);
    console.log(`${row.files} arquivos em ${row.seconds.toFixed(1)} s`);
  } catch (err) {
    console.log(`falhou: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
  }
}

const pct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;
console.log('\n| Projeto | Pilha | Arquivos | Provadas | Por nome | Sem alvo | Rotas | Sensíveis | Operações |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.id} | ${r.stack} | ${r.files} | ${pct(r.proven)} | ${r.heuristic} | ${r.unresolved} | ${r.routes} | ${r.sensitive} | ${r.operations} |`);
}
const out = arg('--json');
if (out) {
  writeFileSync(out, `${JSON.stringify({ measuredAt: new Date().toISOString(), rows }, null, 2)}\n`);
  console.log(`\nnúmeros gravados em ${out}`);
}
