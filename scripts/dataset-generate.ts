// O corpus de treino (D3, decisão 0016): roda `shieldepy chaos <pasta> --offline --dataset` nos
// exemplos do repositório e nos projetos reais que têm contrato guardado em
// scripts/dataset/contratos/<id>/, um por vez, e junta tudo num JSONL (um registro por id).
// Só offline: hipóteses e specs do motor, custo zero. Com a IA, depende da DP6 e de autorização.
//
//   npm run dataset:gerar -- --dir <pasta>          → onde clonar os reais e guardar as partes (fora do repositório)
//   npm run dataset:gerar -- --out <arq.jsonl>      → o corpus (padrão: <dir>/dataset.jsonl)
//   npm run dataset:gerar -- --so checkout,pg-crud  → só esses
//
// Os reais são clonados no commit fixado e instalados com `npm install --ignore-scripts`, mais o que
// o contrato usa (SETUP) sem gravar no package.json deles; o que faltar do arnês vem da CLI (MVP2).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCorpus } from './dataset-corpus';
import { arg, checkout, PROJECTS } from './real-projects';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');
const CONTRACTS = path.join(ROOT, 'scripts', 'dataset', 'contratos');

/** O arnês que os testes gerados importam, nas versões em que o caos foi medido (C1). */
const HARNESS = ['vitest@2.1.9', 'supertest@7', 'msw@2'];
/** As versões do PGlite medidas com o Prisma (0019): as da raiz deste repositório. */
const PGLITE_SOCKET = ['@electric-sql/pglite@0.5.11', '@electric-sql/pglite-socket@0.2.14'];
/** Como preparar cada projeto com contrato guardado. `prisma` são os argumentos do `prisma generate`. */
const SETUP: Record<string, { install?: string[]; noSave: string[]; prisma?: string[] }> = {
  'pg-crud': { noSave: [...HARNESS, '@electric-sql/pglite@0.5.11'] },
  // --omit=dev: as dependências de desenvolvimento dele (Nx, Jest) não são usadas e demoram; o prisma é o da versão do cliente
  realworld: { install: ['--omit=dev'], noSave: ['prisma@4.16.2'], prisma: ['--schema', 'src/prisma/schema.prisma'] },
  'prisma-express': { noSave: PGLITE_SOCKET, prisma: [] },
};

interface Target {
  id: string;
  /** A pasta do projeto (já preparada). */
  prepare: () => string;
  /** Argumentos a mais do `chaos`. */
  args?: string[];
  /** Só estas hipóteses entram no corpus. */
  keep?: string[];
}

/**
 * Um par real: um commit que corrigiu um defeito que o caos reproduz. O lado de antes vai numa pasta `<id>`
 * e o de depois em `<id>-fixed`: o sufixo é o que junta os dois. O contrato é o mesmo nos dois lados.
 */
interface RealPair {
  id: string;
  repo: string;
  before: string;
  after: string;
  /** A pasta do app dentro do monorepo (o clone é inteiro: o lockfile e a licença ficam na raiz). */
  sub: string;
  pnpm: { version: string; filter: string };
  /**
   * A hipótese que o commit corrige. O caos não diz qual tabela causou o 500: as outras hipóteses de corrida da
   * rota rodam o mesmo teste e dariam exemplos de treino com a causa errada.
   */
  keep: string[];
}

const REAL_PAIRS: RealPair[] = [
  {
    id: 'telemetry-tracker',
    repo: 'Telemetry-Tracker/telemetry-tracker',
    before: 'dad773bd4cce0f7683704d2f78f1951e55dc0342',
    after: '369bba2410f4cd96c85d3399885a7b53ce27e276',
    sub: 'apps/api',
    pnpm: { version: '9.15.9', filter: 'api...' },
    keep: ['POST /ingest/error__race_condition__errorGroup'],
  },
  {
    id: 'telemetry-tracker-sessao',
    repo: 'Telemetry-Tracker/telemetry-tracker',
    before: 'dcbbc6a2912691b90a7167d3058683f0cab286bc',
    after: '4639cc51f51bda7055b8e9d191dd74039edfb3c4',
    sub: 'apps/api',
    pnpm: { version: '9.15.9', filter: 'api...' },
    keep: ['POST /ingest/session__race_condition__session'],
  },
];

/**
 * No Windows, o Node não lê o `package.json` de um caminho com mais de 259 caracteres e só diz que o
 * `#main-entry-point` do Prisma "não está definido". O pnpm põe ~120 caracteres depois da pasta do clone.
 */
const MAX_CLONE_PATH = 120;

function pnpmInstall(cwd: string, pnpm: RealPair['pnpm']): void {
  const env = { ...process.env, NODE_OPTIONS: '--use-system-ca' };
  const r = spawnSync('npx', ['--yes', `pnpm@${pnpm.version}`, 'install', '--ignore-scripts', '--frozen-lockfile', '--filter', pnpm.filter], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`pnpm install falhou em ${cwd}:\n${(r.stderr || r.stdout).slice(-1500)}`);
}

function npm(cwd: string, args: string[]): void {
  // npm.cmd no Windows só roda com shell; os argumentos são nomes de pacote, sem espaço
  const r = spawnSync('npm', [...args, '--no-audit', '--no-fund'], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} falhou em ${cwd}:\n${(r.stderr || r.stdout).slice(-1500)}`);
}

/** O Prisma 7 lê a URL só para carregar a configuração: o generate não conecta em nada. Atrás de proxy, ele precisa dos certificados do sistema. */
function prismaGenerate(cwd: string, args: string[]): void {
  const env = { ...process.env, DATABASE_URL: 'postgresql://u:p@localhost:5432/x', NODE_OPTIONS: '--use-system-ca' };
  const r = spawnSync('npx', ['prisma', 'generate', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: true, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`prisma generate falhou em ${cwd}:\n${(r.stderr || r.stdout).slice(-1500)}`);
}

// o arnês dos exemplos Fastify é o da CLI (MVP2): basta o node_modules deles, sem Vitest
const examples: Target[] = ['checkout-express', 'checkout-express-fixed', 'checkout-fastify', 'checkout-fastify-fixed'].map((id) => ({
  id,
  prepare: () => {
    const dir = path.join(ROOT, 'examples', id);
    if (!existsSync(path.join(dir, 'node_modules'))) npm(dir, ['install', '--ignore-scripts']);
    return dir;
  },
}));

const reals: Target[] = PROJECTS.filter((p) => existsSync(path.join(CONTRACTS, p.id))).map((p) => ({
  id: p.id,
  prepare: () => {
    const dir = checkout(p, workDir);
    // o contrato por cima do clone: shieldepy.chaos.config.ts e chaos/ (o código do projeto não muda)
    cpSync(path.join(CONTRACTS, p.id), dir, { recursive: true, force: true });
    const setup = SETUP[p.id] ?? { noSave: HARNESS };
    if (!existsSync(path.join(dir, 'node_modules'))) {
      npm(dir, ['install', '--ignore-scripts', ...(setup.install ?? [])]);
      npm(dir, ['install', '--ignore-scripts', '--no-save', ...(setup.install ?? []), ...setup.noSave]);
    }
    if (setup.prisma) prismaGenerate(dir, setup.prisma);
    return dir;
  },
}));

const pairs: Target[] = REAL_PAIRS.flatMap((p) =>
  [
    { id: p.id, commit: p.before },
    { id: `${p.id}-fixed`, commit: p.after },
  ].map(({ id, commit }) => ({
    id,
    args: ['--only-contract'],
    keep: p.keep,
    prepare: () => {
      const clone = path.join(workDir, id);
      if (process.platform === 'win32' && clone.length > MAX_CLONE_PATH) throw new Error(`caminho longo demais para o pnpm no Windows (${clone.length}): use um --dir mais curto`);
      checkout({ id, repo: p.repo, commit, stack: '' }, workDir);
      const dir = path.join(clone, p.sub);
      cpSync(path.join(CONTRACTS, p.id), dir, { recursive: true, force: true });
      if (!existsSync(path.join(dir, 'node_modules'))) pnpmInstall(clone, p.pnpm);
      prismaGenerate(dir, []);
      return dir;
    },
  }))
);

const workDir = path.resolve(arg('--dir') ?? path.join(os.tmpdir(), 'shieldepy-dataset'));
const out = path.resolve(arg('--out') ?? path.join(workDir, 'dataset.jsonl'));
const parts = path.join(workDir, 'partes');
const only = arg('--so')?.split(',');
const selected = [...examples, ...reals, ...pairs].filter((t) => !only || only.some((o) => t.id.includes(o)));
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
  const r = spawnSync(process.execPath, [CLI, 'chaos', dir, '--offline', ...(t.args ?? []), '--dataset', part], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (t.keep && existsSync(part)) {
    const lines = readFileSync(part, 'utf8').split('\n').filter((l) => l && t.keep!.includes((JSON.parse(l) as { hypothesis: { id: string } }).hypothesis.id));
    writeFileSync(part, lines.map((l) => `${l}\n`).join(''));
  }
  // exit 0 (nada achado) e 1 (achado) são resultados; 2 é o ambiente
  if (r.status !== 0 && r.status !== 1) console.log(`erro de ambiente (exit ${r.status}, ${secs} s):\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`);
  else console.log(`exit ${r.status}, ${secs} s`);
  if (dir.startsWith(path.join(ROOT, 'examples'))) rmSync(path.join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
}

writeCorpus(parts, out);
