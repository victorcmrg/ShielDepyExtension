#!/usr/bin/env node
// Confere a demo sem abrir janela: prepara (se precisar), sobe o portal, percorre o ROTEIRO.md num
// VS Code de teste (o mesmo do E2E) e encerra TUDO no fim, inclusive o portal.
//   npm run demo:verificar
// Use antes da apresentação. Leva uns 3 minutos (os testes de caos rodam 4 vezes).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEMO_SCRIPT = fileURLToPath(new URL('./demo.mjs', import.meta.url));
const isWin = process.platform === 'win32';

// a demo sem o VS Code de verdade: só prepara e mantém o portal no ar
const demo = spawn(process.execPath, [DEMO_SCRIPT, '--sem-vscode'], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const seed = JSON.parse(readFileSync(join(ROOT, '.demo', 'seed.json'), 'utf8'));
  await runTests({
    extensionDevelopmentPath: join(ROOT, 'apps', 'vscode'),
    extensionTestsPath: fileURLToPath(new URL('./verificar-suite.cjs', import.meta.url)),
    launchArgs: [join(ROOT, '.demo', 'sistema-loja'), '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    extensionTestsEnv: { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', SHIELDEPY_DEMO_TOKEN: seed.deviceToken, DEMO_SCRIPT },
    // o VS Code de teste baixado pelo E2E fica em apps/vscode/.vscode-test (reaproveitado)
    cachePath: join(ROOT, 'apps', 'vscode', '.vscode-test'),
  });
  console.log('\n✓ demo verificada: o roteiro inteiro funciona.');
  exitCode = 0;
} catch (err) {
  console.error(`\n✖ a verificação da demo falhou: ${err.message ?? err}`);
} finally {
  stopDemo();
}
process.exit(exitCode);
