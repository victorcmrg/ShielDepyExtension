// Teste de ponta a ponta: baixa um VS Code de verdade, instala a extensão (dist/) e roda
// `suite.cjs` DENTRO dele, num workspace temporário com os exemplos de colisão e um ciclo.
// Uso: npm run test:e2e -w shieldepy   (precisa de `npm run build` antes)

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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

// Servidor de conta falso: a extensão só funciona com acesso liberado pelo /api/me. A suíte liga e
// desliga o acesso da "empresa" via POST /__e2e/access pra testar o bloqueio de verdade.
const E2E_TOKEN = 'e2e-token';
let accessEnabled = true;
const accountServer = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/api/me') {
    if (req.headers.authorization !== `Bearer ${E2E_TOKEN}`) return send(401, { error: 'não autenticado' });
    return send(200, { email: 'e2e@shieldepy.test', companyId: 1, companyName: 'E2E', permissions: { accessEnabled, aiEnabled: false } });
  }
  if (req.method === 'POST' && req.url === '/__e2e/access') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      accessEnabled = JSON.parse(raw || '{}').enabled !== false;
      send(200, { accessEnabled });
    });
    return;
  }
  send(404, { error: 'rota não encontrada' });
});
await new Promise((resolve) => accountServer.listen(0, '127.0.0.1', resolve));
const accountUrl = `http://127.0.0.1:${accountServer.address().port}`;
mkdirSync(join(workspace, '.vscode'), { recursive: true });
writeFileSync(join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'shieldepy.webBaseUrl': accountUrl }, null, 2));

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath: join(here, 'suite.cjs'),
    launchArgs: [workspace, '--disable-extensions', '--skip-welcome', '--skip-release-notes'],
    // Sem chave de IA: o teste exercita o caminho determinístico (ciclos, colisões, offline).
    extensionTestsEnv: { ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', SHIELDEPY_E2E_ACCOUNT_URL: accountUrl, SHIELDEPY_E2E_TOKEN: E2E_TOKEN },
  });
  console.log('E2E: OK');
} catch (err) {
  console.error('E2E: FALHOU', err);
  process.exitCode = 1;
} finally {
  accountServer.close();
  rmSync(workspace, { recursive: true, force: true });
}
