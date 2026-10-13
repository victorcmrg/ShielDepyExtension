// Mede o mapa (grafo + topologia) em projetos reais de terceiros, fixados num commit (etapa M do
// plano). Clona cada um numa pasta FORA do repositório (padrão: <tmp>/shieldepy-mapa-reais), sem
// instalar dependências nem rodar nada deles: só lê o código. Um projeto por vez.
//
//   npm run mapa:reais                       → tabela no terminal
//   npm run mapa:reais -- --dir <pasta>      → onde clonar (reaproveita o que já estiver lá)
//   npm run mapa:reais -- --so realworld,nest → só esses
//   npm run mapa:reais -- --json <arquivo>   → também grava os números

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildSystemGraph, buildTopology, CodeGraph, indexFiles, listSourceFiles, silentHost } from '../packages/core/src/index';
import { defaultWasmDir } from '../packages/core/src/wasm-path';

interface Project {
  id: string;
  repo: string;
  commit: string;
  /** Subpasta do projeto dentro do repositório (clonada com sparse checkout). */
  sub?: string;
  stack: string;
}

/** Os projetos medidos em 2026-10-13 (tabela no registro da etapa M do PLANO-CHAOS.md). */
const PROJECTS: Project[] = [
  { id: 'realworld', repo: 'gothinkster/node-express-realworld-example-app', commit: '30b68e1e881462b2f4164ea09ab4c4f5699c7b0b', stack: 'TS, Express, Prisma' },
  { id: 'prisma-express', repo: 'prisma/prisma-examples', commit: 'caa902a819be2e8fe1e0b0ec2f543e9220cf69cc', sub: 'orm/express', stack: 'TS, Express 5, Prisma 7' },
  { id: 'pg-crud', repo: 'manfraio/rest_api_with_nodejs_and_postgres', commit: 'fdd9fc7f47b0c487000225a85fde52496ab08e10', stack: 'JS (CJS), Express, pg' },
  { id: 'node-express-boilerplate', repo: 'hagopj13/node-express-boilerplate', commit: '179ae84efec61b14206d0305d941daed6c6d07f9', stack: 'JS (CJS), Express, Mongoose' },
  { id: 'express-rest-boilerplate', repo: 'danielfsousa/express-rest-boilerplate', commit: 'b8bed6d7cfce3cf2ef89ec1b5e47b52dfc50e874', stack: 'JS (CJS), Express, Mongoose' },
  { id: 'express-typescript-boilerplate', repo: 'w3tecch/express-typescript-boilerplate', commit: '17727010f7f098d8ca8b78da0a5b3c7297659381', stack: 'TS, routing-controllers, TypeORM' },
  { id: 'hackathon-starter', repo: 'sahat/hackathon-starter', commit: '574a99344855a2f18dac7181636e400bd55ab578', stack: 'JS (CJS), Express, Mongoose' },
  { id: 'bulletproof-nodejs', repo: 'santiq/bulletproof-nodejs', commit: '7ce1b4690c4e96659cb1ed0d367b08b3ab35a24b', stack: 'TS, Express, typedi, Mongoose' },
  { id: 'proshop-v2', repo: 'bradtraversy/proshop-v2', commit: 'e23e3a897e5387f39da6c59fd72cdd12e46d0815', stack: 'JS (ESM), Express, Mongoose, React' },
  { id: 'jwt-auth-mongodb', repo: 'bezkoder/node-js-jwt-auth-mongodb', commit: '90a2d72d81392ba53f093c9d12a08bc2d822c969', stack: 'JS (CJS), Express, Mongoose' },
  { id: 'mern-memories', repo: 'adrianhajdin/project_mern_memories', commit: '9c2c4166ea359ef07417d112cb4b892ef47cb198', stack: 'JS (ESM), Express, Mongoose, React' },
  { id: 'nest-realworld', repo: 'lujakob/nestjs-realworld-example-app', commit: 'c1c2cc4e448b279ff083272df1ac50d20c3304fa', stack: 'TS, NestJS, TypeORM' },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// `core.longpaths`: no Windows, uma pasta temporária funda estoura o limite de caminho ao gravar o pack
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.longpaths=true', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

/** Clona só o commit fixado (`--depth 1`), ou reaproveita a pasta se ela já estiver nele. */
function checkout(p: Project, dir: string): string {
  const target = path.join(dir, p.id);
  if (!existsSync(path.join(target, '.git'))) {
    mkdirSync(target, { recursive: true });
    git(target, 'init', '-q');
    git(target, 'remote', 'add', 'origin', `https://github.com/${p.repo}`);
    if (p.sub) {
      git(target, 'config', 'core.sparseCheckout', 'true');
      writeFileSync(path.join(target, '.git', 'info', 'sparse-checkout'), `${p.sub}/\n`);
    }
  }
  let head = '';
  try {
    head = git(target, 'rev-parse', 'HEAD');
  } catch {
    // repositório recém-criado, ainda sem commit
  }
  if (head !== p.commit) {
    git(target, 'fetch', '-q', '--depth', '1', 'origin', p.commit);
    git(target, 'checkout', '-q', 'FETCH_HEAD');
  }
  return p.sub ? path.join(target, p.sub) : target;
}

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
