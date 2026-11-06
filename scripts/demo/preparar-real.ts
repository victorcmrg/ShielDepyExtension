// A abertura da demo (0032): o realworld, um projeto real do GitHub, pronto para a extensão instalada.
// Quem chama é o atalho "ShielDepy 1 - Sistema real" (scripts/demo/atalhos/), que depois gera o .vsix,
// instala e abre o VS Code.
//
//   npm run demo:real                → prepara em ~/ShielDepy-real/realworld
//   npm run demo:real -- --dir <pasta>
//
// Pode rodar de novo: o que já está pronto fica. O resultado do caos é apagado a cada vez, para o
// projeto abrir limpo: a extensão carrega o que achar, e um resultado antigo parece análise nova.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { arg, checkout, HARNESS, PGLITE_SOCKET, PROJECTS } from '../real-projects';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTRACT = path.join(ROOT, 'scripts', 'dataset', 'contratos', 'realworld');
/** Atrás de proxy, o npm e o download do motor do Prisma precisam dos certificados do sistema. */
const NODE_OPTIONS = '--use-system-ca';
const PRISMA_CLIENT = path.join('node_modules', '.prisma', 'client', 'index.js');
const PRISMA_ATTEMPTS = 5;

function npm(cwd: string, args: string[]): void {
  // npm.cmd no Windows só roda com shell; os argumentos são nomes de pacote, sem espaço
  const r = spawnSync('npm', [...args, '--no-audit', '--no-fund'], { cwd, stdio: 'inherit', shell: true, env: { ...process.env, NODE_OPTIONS } });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} saiu com código ${r.status}`);
}

/**
 * O download do motor do Prisma (binaries.prisma.sh) às vezes cai com "socket hang up": sem repetir, o
 * cliente não sai e os 5 testes dão inválido. Pelo arquivo do Prisma, sem `npx`, para o erro aparecer.
 */
async function prismaGenerate(cwd: string): Promise<void> {
  const env = { ...process.env, NODE_OPTIONS, DATABASE_URL: 'postgresql://u:p@localhost:5432/x' };
  const cli = path.join('node_modules', 'prisma', 'build', 'index.js');
  for (let attempt = 1; attempt <= PRISMA_ATTEMPTS; attempt++) {
    spawnSync(process.execPath, [cli, 'generate', '--schema', path.join('src', 'prisma', 'schema.prisma')], { cwd, stdio: 'inherit', env });
    if (existsSync(path.join(cwd, PRISMA_CLIENT))) return;
    console.log(`prisma generate: tentativa ${attempt} de ${PRISMA_ATTEMPTS} não gerou o cliente`);
    await sleep(5000);
  }
  throw new Error('o prisma generate não gerou o cliente: confira a rede e rode de novo');
}

const project = PROJECTS.find((p) => p.id === 'realworld')!;
const workDir = path.resolve(arg('--dir') ?? path.join(os.homedir(), 'ShielDepy-real'));
const dir = checkout(project, workDir);
// o contrato por cima do clone: shieldepy.chaos.config.ts e chaos/ (o código do projeto não muda)
cpSync(CONTRACT, dir, { recursive: true, force: true });
if (!existsSync(path.join(dir, 'node_modules', 'vitest', 'vitest.mjs'))) {
  npm(dir, ['install', '--ignore-scripts', '--omit=dev']);
  // num comando só: um segundo `--no-save` tiraria o que o primeiro pôs. A extensão não tem arnês (DP8): usa o do projeto
  npm(dir, ['install', '--ignore-scripts', '--omit=dev', '--no-save', 'prisma@4.16.2', ...HARNESS, ...PGLITE_SOCKET]);
}
if (!existsSync(path.join(dir, PRISMA_CLIENT))) await prismaGenerate(dir);
rmSync(path.join(dir, '.shieldepy'), { recursive: true, force: true });
console.log(`realworld pronto: ${dir}`);
