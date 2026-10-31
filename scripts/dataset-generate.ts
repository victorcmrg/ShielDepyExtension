// O corpus de treino (D3, decisão 0016): roda `shieldepy chaos <pasta> --offline --dataset` nos
// exemplos do repositório e nos projetos reais que têm contrato guardado em
// scripts/dataset/contratos/<id>/, um por vez, e junta tudo num JSONL (um registro por id).
// Só offline: hipóteses e specs do motor, custo zero. Com a IA, depende da DP6 e de autorização.
//
//   npm run dataset:gerar -- --dir <pasta>          → onde clonar os reais e guardar as partes (fora do repositório)
//   npm run dataset:gerar -- --out <arq.jsonl>      → o corpus (padrão: <dir>/dataset.jsonl)
//   npm run dataset:gerar -- --so checkout,pg-crud  → só esses
//
// Os reais são clonados no commit fixado e instalados com `npm install --ignore-scripts`, mais o
// arnês do caos (Vitest, supertest, MSW e o que o contrato usa) sem gravar no package.json deles.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetJsonl, mergeDatasetJsonl } from '../packages/agent/src/chaos/dataset';
import { arg, checkout, PROJECTS } from './real-projects';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');
const CONTRACTS = path.join(ROOT, 'scripts', 'dataset', 'contratos');

/** O arnês que os testes gerados importam, nas versões em que o caos foi medido (C1). */
const HARNESS = ['vitest@2.1.9', 'supertest@7', 'msw@2'];
/** O que cada contrato guardado usa além do arnês. */
const CONTRACT_DEPS: Record<string, string[]> = {
  'pg-crud': ['@electric-sql/pglite@0.5.11'],
};

interface Target {
  id: string;
  /** A pasta do projeto (já preparada). */
  prepare: () => string;
}

function npm(cwd: string, args: string[]): void {
  // npm.cmd no Windows só roda com shell; os argumentos são nomes de pacote, sem espaço
  const r = spawnSync('npm', [...args, '--no-audit', '--no-fund'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} falhou em ${cwd}:\n${(r.stderr || r.stdout).slice(-1500)}`);
}

const hasVitest = (dir: string) => existsSync(path.join(dir, 'node_modules', 'vitest', 'vitest.mjs'));

const examples: Target[] = ['checkout-express', 'checkout-express-fixed'].map((id) => ({
  id,
  prepare: () => {
    const dir = path.join(ROOT, 'examples', id);
    if (!hasVitest(dir)) npm(dir, ['install', '--ignore-scripts']);
    return dir;
  },
}));

const reals: Target[] = PROJECTS.filter((p) => existsSync(path.join(CONTRACTS, p.id))).map((p) => ({
  id: p.id,
  prepare: () => {
    const dir = checkout(p, workDir);
    // o contrato por cima do clone: shieldepy.chaos.config.ts e chaos/ (o código do projeto não muda)
    cpSync(path.join(CONTRACTS, p.id), dir, { recursive: true, force: true });
    if (!existsSync(path.join(dir, 'node_modules'))) npm(dir, ['install', '--ignore-scripts']);
    if (!hasVitest(dir)) npm(dir, ['install', '--ignore-scripts', '--no-save', ...HARNESS, ...(CONTRACT_DEPS[p.id] ?? [])]);
    return dir;
  },
}));

const workDir = path.resolve(arg('--dir') ?? path.join(os.tmpdir(), 'shieldepy-dataset'));
const out = path.resolve(arg('--out') ?? path.join(workDir, 'dataset.jsonl'));
const parts = path.join(workDir, 'partes');
const only = arg('--so')?.split(',');
const selected = [...examples, ...reals].filter((t) => !only || only.some((o) => t.id.includes(o)));
mkdirSync(parts, { recursive: true });
console.log(`Corpus em ${workDir} (fora do repositório). Modo offline: nenhuma chamada à IA.\n`);

for (const t of selected) {
  process.stdout.write(`- ${t.id}… `);
  const part = path.join(parts, `${t.id}.jsonl`);
  let dir: string;
  try {
    dir = t.prepare();
  } catch (err) {
    console.log(`não preparou: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
    continue;
  }
  rmSync(part, { force: true }); // a nova execução substitui a parte deste projeto
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, 'chaos', dir, '--offline', '--dataset', part], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  // exit 0 (nada achado) e 1 (achado) são resultados; 2 é o ambiente
  if (r.status !== 0 && r.status !== 1) console.log(`erro de ambiente (exit ${r.status}, ${secs} s):\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`);
  else console.log(`exit ${r.status}, ${secs} s`);
  if (dir.startsWith(path.join(ROOT, 'examples'))) rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
}

const texts = readdirSync(parts)
  .filter((f) => f.endsWith('.jsonl'))
  .sort()
  .map((f) => readFileSync(path.join(parts, f), 'utf8'));
const { records, duplicates, skipped } = mergeDatasetJsonl(texts);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, datasetJsonl(records), 'utf8');

const rows = new Map<string, { variant: string; achado: number; aguentou: number; inválido: number; license: string }>();
for (const r of records) {
  const row = rows.get(r.source.project) ?? { variant: r.source.variant, achado: 0, aguentou: 0, inválido: 0, license: r.source.license?.value ?? '—' };
  row[r.result.outcome]++;
  rows.set(r.source.project, row);
}
console.log('\n| Projeto | Variante | Licença | Achados | Aguentou | Inválidos |');
console.log('|---|---|---|---|---|---|');
for (const [project, r] of rows) console.log(`| ${project} | ${r.variant} | ${r.license} | ${r.achado} | ${r.aguentou} | ${r.inválido} |`);
console.log(`\n${records.length} registro(s) em ${out}${duplicates ? ` (${duplicates} repetido(s) por id, fica o último)` : ''}${skipped ? `; ${skipped} linha(s) fora do formato v1 ignorada(s)` : ''}`);
