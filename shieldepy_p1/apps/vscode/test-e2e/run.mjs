// Teste de ponta a ponta: baixa um VS Code de verdade, instala a extensão (dist/) e roda
// `suite.cjs` DENTRO dele, num workspace temporário com os exemplos de colisão e um ciclo.
// Uso: npm run test:e2e -w shieldepy   (precisa de `npm run build` antes)

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

// Rodando de um terminal dentro do VS Code, esta variável vem herdada e faz o Code.exe
// baixado subir como Node puro em vez de abrir o editor.
delete process.env.ELECTRON_RUN_AS_NODE;

const here = dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = join(here, '..');
const workspace = mkdtempSync(join(tmpdir(), 'shieldepy-e2e-'));

cpSync(join(here, '..', '..', '..', 'examples', 'pedidos-microservices'), workspace, { recursive: true });
writeFileSync(join(workspace, 'a.ts'), "import { b } from './b';\nexport function a() { b(); }\n");
writeFileSync(join(workspace, 'b.ts'), "import { a } from './a';\nexport function b() { a(); }\n");

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: join(here, 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    // Sem chave de IA: o teste exercita o caminho determinístico (ciclos, colisões, offline).
    extensionTestsEnv: { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '' },
  });
  console.log('E2E: OK');
} catch (err) {
  console.error('E2E: FALHOU', err);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
