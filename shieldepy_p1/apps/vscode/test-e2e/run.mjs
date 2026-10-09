// Teste de ponta a ponta: baixa um VS Code de verdade, instala a extensão (dist/) e roda
// `suite.cjs` DENTRO dele, num workspace temporário com os exemplos de colisão e um ciclo.
// Uso: npm run test:e2e -w shieldepy   (precisa de `npm run build` antes)
//      SHIELDEPY_E2E_EXTENSION=<pasta da extensão instalada do .vsix> node test-e2e/run.mjs

import { execFileSync } from 'node:child_process';
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
// SHIELDEPY_E2E_EXTENSION: roda a mesma suíte contra a extensão instalada de um .vsix (confere o pacote).
const extensionDevelopmentPath = process.env.SHIELDEPY_E2E_EXTENSION || join(here, '..');
const workspace = mkdtempSync(join(tmpdir(), 'shieldepy-e2e-'));

cpSync(join(here, '..', '..', '..', 'examples', 'pedidos-microservices'), workspace, { recursive: true });
// Um sistema Express de verdade (DI, barrel, tsconfig `paths`, interface): o mapa tem que sair provado.
// sem o node_modules do exemplo (ele é executável desde a E3): só o código interessa ao mapa
cpSync(join(here, '..', '..', '..', 'examples', 'checkout-express'), join(workspace, 'checkout'), {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes('node_modules'),
});
writeFileSync(join(workspace, 'a.ts'), "import { b } from './b';\nexport function a() { b(); }\n");
writeFileSync(join(workspace, 'b.ts'), "import { a } from './a';\nexport function b() { a(); }\n");

// Um repositório git de verdade: a extensão identifica o repositório pelo remote (e manda a
// branch do HEAD), e o "Comparar mapa com uma branch" (V2d) precisa de um commit para o worktree.
const E2E_REMOTE = 'https://github.com/e2e/pedidos.git';
const git = (...args) => execFileSync('git', ['-c', 'user.email=e2e@e2e', '-c', 'user.name=e2e', '-c', 'core.autocrlf=false', ...args], { cwd: workspace, stdio: 'pipe' });
git('init', '--quiet', '-b', 'main');
git('remote', 'add', 'origin', E2E_REMOTE);
git('add', '-A');
git('commit', '--quiet', '-m', 'base do E2E');

// Servidor de conta falso: a extensão só funciona com acesso liberado pelo /api/me E com o
// repositório num projeto (/api/repos/check). A suíte liga e desliga os dois via /__e2e/*.
const E2E_TOKEN = 'e2e-token';
let accessEnabled = true;
let repoAllowed = true;
let lastRepoCheck = null;
const readJson = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(JSON.parse(raw || '{}')));
  });
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
    readJson(req).then((b) => {
      accessEnabled = b.enabled !== false;
      send(200, { accessEnabled });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/__e2e/repo') {
    readJson(req).then((b) => {
      repoAllowed = b.allowed !== false;
      send(200, { repoAllowed });
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/__e2e/last-repo-check') return send(200, lastRepoCheck ?? {});
  if (req.method === 'POST' && req.url === '/api/repos/check') {
    if (req.headers.authorization !== `Bearer ${E2E_TOKEN}`) return send(401, { error: 'não autenticado' });
    readJson(req).then((b) => {
      lastRepoCheck = b;
      const repos = (b.repos ?? []).map((r) => ({
        remote: r.remote,
        allowed: repoAllowed && r.remote === E2E_REMOTE,
        project: repoAllowed && r.remote === E2E_REMOTE ? { id: 1, name: 'Pedidos' } : null,
      }));
      send(200, { repos });
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
