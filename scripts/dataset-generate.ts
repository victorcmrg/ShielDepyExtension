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
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
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

writeCorpus(parts, out);
