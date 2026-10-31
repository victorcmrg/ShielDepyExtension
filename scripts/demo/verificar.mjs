#!/usr/bin/env node
// Confere a demo sem abrir janela: prepara (se precisar), sobe o portal, percorre o ROTEIRO.md num
// VS Code de teste (o mesmo do E2E) e encerra TUDO no fim, inclusive o portal.
//   npm run demo:verificar
//   npm run demo:verificar -- --so-cli    só o passo do Fastify, pela CLI (sem VS Code e sem portal)
// Use antes da apresentação. Leva uns 2 minutos (os testes de caos rodam 2 vezes, pelo botão do plugin,
// e mais 2 no Fastify, pela CLI).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, WORKSPACE } from './paths.mjs';

const DEMO_SCRIPT = fileURLToPath(new URL('./demo.mjs', import.meta.url));
const isWin = process.platform === 'win32';

/**
 * O passo do Fastify (MVP9), pela CLI e sem VS Code: na extensão, o caos usa o Vitest do projeto, e o
 * checkout-fastify não tem (DP8); pela CLI, ele usa o arnês dela. Confere o que o roteiro mostra: o
 * vulnerável acha os 6 problemas (exit 1) e o corrigido passa (exit 0).
 */
function verificarFastify() {
  console.log('\nFastify, pela CLI (o passo 2 do docs/roteiro-mvp.md):');
  for (const [name, code, failed] of [
    ['checkout-fastify', 1, 6],
    ['checkout-fastify-fixed', 0, 0],
  ]) {
    const dir = join(ROOT, 'examples', name);
    if (!existsSync(join(dir, 'node_modules', 'fastify'))) throw new Error(`falta o npm install em examples/${name}`);
    const run = spawnSync(process.execPath, [join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js'), 'chaos', dir, '--offline', '--json'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    rmSync(join(dir, '.shieldepy', 'chaos-tests'), { recursive: true, force: true });
    const out = run.stdout ?? '';
    const results = out.includes('{') ? JSON.parse(out.slice(out.indexOf('{'))).results ?? [] : [];
    const hits = results.filter((r) => r.status === 'failed').length;
    if (run.status !== code || hits !== failed) throw new Error(`${name}: esperava exit ${code} e ${failed} achado(s), veio exit ${run.status} e ${hits}\n${(run.stderr ?? '').slice(-1500)}`);
    console.log(`  ✓ ${name}: exit ${code}, ${hits} achado(s), ${results.length - hits} sem achado`);
  }
}

if (process.argv.includes('--so-cli')) {
  try {
    verificarFastify();
    console.log('\n✓ o passo do Fastify funciona.');
    process.exit(0);
  } catch (err) {
    console.error(`\n✖ ${err.message ?? err}`);
    process.exit(1);
  }
}

// a demo sem o VS Code de verdade e sem o histórico do portal: só prepara e mantém o portal no ar
const demo = spawn(process.execPath, [DEMO_SCRIPT, '--sem-vscode', '--sem-historico'], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
const stopDemo = () => {
  if (demo.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' });
  else demo.kill('SIGINT');
};
process.on('exit', stopDemo);
process.on('SIGINT', () => process.exit(130));

let exitCode = 1;
try {
  await new Promise((resolve, reject) => {
    let out = '';
    demo.stdout.on('data', (d) => {
      out += d;
      for (const line of String(d).split(/\r?\n/)) if (/✓|!|✖|\[\d\/\d\]/.test(line)) console.log(line);
      if (out.includes('demo pronta')) resolve();
    });
    demo.stderr.on('data', (d) => (out += d));
    demo.on('exit', (code) => reject(new Error(`a demo parou (código ${code}):\n${out.slice(-2000)}`)));
  });

  console.log('\nabrindo um VS Code de teste (sem janela) no sistema da demo...');
  const require = createRequire(join(ROOT, 'apps', 'vscode', 'package.json'));
  const { runTests } = require('@vscode/test-electron');
  // rodando de dentro de um VS Code, estas variáveis fariam o VS Code de teste subir sem janela
  for (const k of Object.keys(process.env)) if (/^(VSCODE_|ELECTRON_|CHROME_CRASHPAD)/i.test(k)) delete process.env[k];
  await runTests({
    extensionDevelopmentPath: join(ROOT, 'apps', 'vscode'),
    extensionTestsPath: fileURLToPath(new URL('./verificar-suite.cjs', import.meta.url)),
    launchArgs: [WORKSPACE, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    // sem SHIELDEPY_DEMO_TOKEN: o plugin tem que achar o token no .vscode/settings.json da demo, como na janela de verdade
    extensionTestsEnv: { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', DEMO_SCRIPT },
    // o VS Code de teste baixado pelo E2E fica em apps/vscode/.vscode-test (reaproveitado)
    cachePath: join(ROOT, 'apps', 'vscode', '.vscode-test'),
  });
  verificarFastify();
  console.log('\n✓ demo verificada: o roteiro inteiro funciona.');
  exitCode = 0;
} catch (err) {
  console.error(`\n✖ a verificação da demo falhou: ${err.message ?? err}`);
} finally {
  stopDemo();
}
process.exit(exitCode);
