// Mutantes para o DPO (D4, decisão 0016): a partir do código que aguenta (o checkout-express-fixed
// e os reais já preparados pelo `dataset:gerar` na mesma pasta), uma mutação pela AST por mutante,
// numa cópia fora do repositório; roda o `chaos --offline --dataset` em cada um e grava a parte
// dele com a fonte do original e a variante `mutante:<operador>@<arquivo>:<linha>`. Depois junta o
// corpus, como o `dataset:gerar`.
//
//   npm run dataset:mutantes -- --dir <pasta do dataset:gerar> [--out <arq.jsonl>] [--so sem-timeout]

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSourceFiles, TS_EXTENSIONS, TsParser } from '../packages/core/src/index';
import { defaultWasmDir } from '../packages/core/src/wasm-path';
import { asMutantRecord, datasetJsonl, mergeDatasetJsonl } from '../packages/agent/src/chaos/dataset';
import { applyEdits, findMutations, mutantVariant, type Mutation } from '../packages/agent/src/chaos/mutations';
import { DATASET_DB_ENV, datasetSource, dbHost, publishDataset } from '../apps/cli/src/dataset';
import { writeCorpus } from './dataset-corpus';
import { arg, PROJECTS } from './real-projects';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');
const CONTRACTS = path.join(ROOT, 'scripts', 'dataset', 'contratos');

const workDir = path.resolve(arg('--dir') ?? path.join(os.tmpdir(), 'shieldepy-dataset'));
const out = path.resolve(arg('--out') ?? path.join(workDir, 'dataset.jsonl'));
const parts = path.join(workDir, 'partes');
const only = arg('--so')?.split(',');
mkdirSync(parts, { recursive: true });
/** Com a variável do banco do treino (0020), os registros corrigidos vão para lá. */
const dbUrl = process.env[DATASET_DB_ENV]?.trim() || undefined;
const childEnv = { ...process.env };
delete childEnv[DATASET_DB_ENV];

/** O código que aguenta: o exemplo corrigido e os reais com contrato que o `dataset:gerar` já preparou. */
const bases = [
  { id: 'checkout-express-fixed', dir: path.join(ROOT, 'examples', 'checkout-express-fixed') },
  ...PROJECTS.filter((p) => existsSync(path.join(CONTRACTS, p.id)) && existsSync(path.join(workDir, p.id))).map((p) => ({
    id: p.id,
    dir: p.sub ? path.join(workDir, p.id, p.sub) : path.join(workDir, p.id),
  })),
];

/** Fora da mutação: o contrato do caos e o que o ShielDepy gera. */
const ownFile = (rel: string) => rel === 'shieldepy.chaos.config.ts' || rel.startsWith('chaos/') || rel.startsWith('.shieldepy/');
const SKIP_COPY = new Set(['node_modules', '.shieldepy', '.git']);

const parser = await TsParser.load(defaultWasmDir());
console.log(`Mutantes em ${path.join(workDir, 'mutantes')} (fora do repositório). Modo offline: nenhuma chamada à IA.\n`);

for (const base of bases) {
  if (!existsSync(path.join(base.dir, 'node_modules'))) {
    console.log(`- ${base.id}: sem node_modules (rode o dataset:gerar antes)`);
    continue;
  }
  const source = datasetSource(base.dir);
  const mutations: Mutation[] = [];
  for (const full of await listSourceFiles(base.dir)) {
    const rel = path.relative(base.dir, full).split(path.sep).join('/');
    if (ownFile(rel) || !TS_EXTENSIONS.includes(path.extname(full).toLowerCase() as (typeof TS_EXTENSIONS)[number])) continue;
    mutations.push(...findMutations(parser, rel, readFileSync(full, 'utf8'), TsParser.isJsxPath(full)));
  }
  const selected = mutations.filter((m) => !only || only.includes(m.operator));
  console.log(`- ${base.id}: ${mutations.length} mutante(s)${only ? `, ${selected.length} pedido(s)` : ''}`);

  for (const [n, m] of selected.entries()) {
    const variant = mutantVariant(m);
    const name = `${base.id}__${m.operator}-${n + 1}`;
    const dir = path.join(workDir, 'mutantes', name);
    rmSync(dir, { recursive: true, force: true });
    cpSync(base.dir, dir, { recursive: true, filter: (src) => !SKIP_COPY.has(path.basename(src)) || path.dirname(src) !== base.dir });
    // as dependências do original, sem copiar: uma junção (no Windows não precisa de permissão)
    symlinkSync(path.join(base.dir, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
    const file = path.join(dir, m.file);
    writeFileSync(file, applyEdits(readFileSync(file, 'utf8'), m.edits), 'utf8');

    const tmp = path.join(dir, '.shieldepy', 'dataset.jsonl');
    const started = Date.now();
    // o filho não envia ao banco: o registro dele tem a fonte da cópia; quem envia é este script, já corrigido
    const r = spawnSync(process.execPath, [CLI, 'chaos', dir, '--offline', '--dataset', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: childEnv });
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    const records = existsSync(tmp) ? mergeDatasetJsonl([readFileSync(tmp, 'utf8')]).records : [];
    const mutated = records.map((rec) => asMutantRecord(rec, source, { operator: m.operator, file: m.file, line: m.line, description: m.description }, variant, 'offline'));
    writeFileSync(path.join(parts, `${name}.jsonl`), datasetJsonl(mutated), 'utf8');
    if (dbUrl && mutated.length > 0) {
      try {
        console.log(`  ✓ ${await publishDataset(mutated, dbUrl)} registro(s) enviado(s) a ${dbHost(dbUrl)}`);
      } catch (err) {
        console.log(`  ⚠ não deu para enviar a ${dbHost(dbUrl)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const hits = mutated.filter((rec) => rec.result.outcome === 'achado').map((rec) => rec.hypothesis.failure + '/' + rec.hypothesis.target);
    const status = r.status === 0 || r.status === 1 ? `exit ${r.status}` : `erro de ambiente (exit ${r.status})`;
    console.log(`  ${variant}: ${m.description}; ${status}, ${secs} s; achados: ${hits.length ? hits.join(', ') : 'nenhum'}`);
    if (r.status !== 0 && r.status !== 1) console.log((r.stderr || r.stdout).trim().split('\n').slice(-6).map((l) => `    ${l}`).join('\n'));
  }
}

writeCorpus(parts, out);
