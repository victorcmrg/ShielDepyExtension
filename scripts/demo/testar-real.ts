// O teste no realworld (projeto real do GitHub) pela CLI, sem VS Code: prepara o projeto (o mesmo
// preparo do atalho "ShielDepy 1 - Sistema real"), roda o caos e grava o mapa com o resultado por cima.
//
//   npm run real:testar                    → prepara, roda o caos e abre o mapa no navegador
//   npm run real:testar -- --sem-caos      → só o mapa (sem rodar testes; segundos)
//   npm run real:testar -- --sem-abrir     → não abre o navegador
//   npm run real:testar -- --dir <pasta>   → outra pasta (padrão: ~/ShielDepy-real)
//
// Os arquivos ficam em <pasta>/realworld/.shieldepy/: mapa.html e relatorio-caos.md.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from '../real-projects';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = path.join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');
const workDir = path.resolve(arg('--dir') ?? path.join(os.homedir(), 'ShielDepy-real'));
const dir = path.join(workDir, 'realworld');
const out = path.join(dir, '.shieldepy');
const html = path.join(out, 'mapa.html');
const report = path.join(out, 'relatorio-caos.md');
const withChaos = !process.argv.includes('--sem-caos');
const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1).replace('.', ',');

function run(label: string, args: string[]): number {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

const started = Date.now();
// o preparo é o do demo:real: clona no commit fixado só na primeira vez e apaga o resultado antigo
if (run('Preparando o realworld', ['--import', 'tsx', path.join(ROOT, 'scripts', 'demo', 'preparar-real.ts'), '--dir', workDir]) !== 0) {
  console.error('\nO preparo não deu certo: veja a mensagem acima.');
  process.exit(1);
}

const ranAt = Date.now();
const code = withChaos
  ? run('Rodando o caos pela CLI (motor, sem IA)', [CLI, 'chaos', dir, '--offline', '--report', report, '--html', html])
  : run('Montando o mapa pela CLI', [CLI, 'topology', dir, '--html', html]);

// caos: 0 = aguentou, 1 = achou problema (o esperado no realworld), 2 = nada provado
if (code > 2 || !existsSync(html)) {
  console.error(`\nA CLI saiu com código ${code} e o mapa não foi gravado: veja a mensagem acima.`);
  process.exit(code || 1);
}
console.log(`\n${withChaos ? 'Caos' : 'Mapa'} em ${seconds(ranAt)} s (total com o preparo: ${seconds(started)} s).`);
if (withChaos) console.log(code === 1 ? 'Resultado: o caos achou problema (saída 1).' : code === 0 ? 'Resultado: o código aguentou (saída 0).' : 'Resultado: nada foi provado (saída 2); veja o relatório.');
console.log(`Mapa:      ${html}`);
if (withChaos) console.log(`Relatório: ${report}`);

if (!process.argv.includes('--sem-abrir')) {
  // o navegador padrão do sistema; no Windows, o "start" precisa de um título vazio antes do caminho
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', `"${html}"`]] : [process.platform === 'darwin' ? 'open' : 'xdg-open', [html]];
  spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsVerbatimArguments: true }).unref();
}
process.exit(code === 2 ? 2 : 0);
