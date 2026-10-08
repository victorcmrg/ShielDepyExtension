// `npm run dev`: sobe a API (tsx watch, porta API_PORT, padrão 3001) e o Vite (porta PORT, padrão 5173)
// juntos. Cada um recebe a porta explícita: um PORT herdado do ambiente não pode jogar os dois na mesma.
// O Vite faz proxy de /api, /analyze e /chat pra API (vite.config.ts lê API_PORT).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = process.env.API_PORT || '3001';
const WEB_PORT = process.env.PORT || '5173';
const bin = (spec) => fileURLToPath(import.meta.resolve(spec));
// o vite não exporta bin/ no package.json: acha o pacote e monta o caminho
const viteBin = fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json')));

const procs = [];
// encerra o processo e os filhos dele (o tsx watch roda o servidor num neto; no Windows kill() só mata o pai)
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}
function run(name, color, args, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (from, to) => from.on('data', (buf) => to.write(buf.toString().replace(/^(?=.)/gm, tag)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    // um caiu, derruba o outro (como o `concurrently -k`)
    procs.forEach((p) => p !== child && stop(p));
    process.exitCode = code ?? 0;
  });
  procs.push(child);
}

run('api', 32, [bin('tsx/cli'), 'watch', '--env-file-if-exists=../../.env', 'server/server.ts'], { PORT: API_PORT });
run('web', 36, [viteBin, '--port', WEB_PORT, '--strictPort'], { API_PORT });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => procs.forEach(stop));
