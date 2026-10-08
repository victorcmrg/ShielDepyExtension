#!/usr/bin/env node
// Demo do ShielDepy para a apresentação: prepara tudo e abre o VS Code com o plugin num sistema de
// exemplo (uma loja: checkout com Stripe e Postgres, microserviços de pedidos e relatórios), já
// logado num portal local, com o ROTEIRO.md aberto ao lado.
//
//   npm run demo                 prepara (na 1ª vez instala e compila), sobe o portal e abre o VS Code
//   npm run demo -- --do-zero    apaga a pasta da demo e recria tudo
//   npm run demo -- --compilar   recompila a extensão e o portal antes
//   npm run demo -- --sem-vscode só prepara e sobe o portal (abra o VS Code pelo comando impresso)
//   npm run demo:caos            roda o caos de novo no checkout da demo e publica no portal
//
// Nada é criado dentro do repositório: a demo mora em ~/ShielDepy-demo (ou em DEMO_DIR), com o
// sistema, o banco do portal e o perfil do VS Code (ver paths.mjs). O sistema abre numa janela NOVA
// do VS Code, com a extensão do repositório carregada (--extensionDevelopmentPath).
// Funciona no Windows (caminhos com acento e espaço), no Linux e no macOS. Precisa de Node >= 22.6,
// git e o VS Code instalado. Ctrl+C no terminal encerra o portal (o VS Code da demo fica aberto).

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, DEMO, PORTAL_DATA, ROOT, SEED_FILE, VSCODE_EXTENSIONS, VSCODE_PROFILE, WORKSPACE } from './paths.mjs';

const EXAMPLES = join(ROOT, 'examples');
const PORT = Number(process.env.DEMO_PORT) || 3001;
const PORTAL = `http://localhost:${PORT}`;
/** O "repositório" da demo. É só o remote do git local: nada é enviado para lá. */
const DEMO_REMOTE = 'https://github.com/acme-demo/sistema-loja.git';
const CLI = join(ROOT, 'apps', 'cli', 'bin', 'shieldepy.js');
const TSX = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SELF = fileURLToPath(import.meta.url);

const args = new Set(process.argv.slice(2));
const isWin = process.platform === 'win32';

// ---------------------------------------------------------------- saída
const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = c('1');
const green = c('32');
const yellow = c('33');
const red = c('31');
const dim = c('2');
const step = (n, total, msg) => console.log(`\n${bold(`[${n}/${total}]`)} ${msg}`);
const ok = (msg) => console.log(`  ${green('✓')} ${msg}`);
const warn = (msg) => console.log(`  ${yellow('!')} ${msg}`);
function fail(msg) {
  console.error(`\n${red('✖')} ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- processos
/** Roda e espera o fim (nada fica rodando depois). Devolve o resultado. */
function run(cmd, cmdArgs, { cwd = ROOT, env = {}, show = false, allow = [0], shell = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: show ? 'inherit' : 'pipe', encoding: 'utf8', shell });
  if (r.error) fail(`não consegui rodar ${cmd}: ${r.error.message}`);
  if (!allow.includes(r.status)) {
    if (!show) console.error((r.stdout ?? '') + (r.stderr ?? ''));
    fail(`${[cmd, ...cmdArgs].join(' ')} saiu com código ${r.status}`);
  }
  return r;
}

/** npm sem shell: pelo npm-cli.js que o próprio `npm run` informa (caminhos com espaço funcionam). */
function npm(npmArgs, opts) {
  const npmCli = process.env.npm_execpath;
  if (npmCli && npmCli.endsWith('.js')) return run(process.execPath, [npmCli, ...npmArgs], opts);
  return run(isWin ? 'npm.cmd' : 'npm', npmArgs, { ...opts, shell: isWin });
}

const node = (scriptArgs, opts) => run(process.execPath, scriptArgs, opts);
const git = (gitArgs, cwd = WORKSPACE) =>
  run('git', ['-c', 'user.name=Demo ShielDepy', '-c', 'user.email=demo@shieldepy.local', '-c', 'core.autocrlf=false', ...gitArgs], { cwd });
const currentBranch = () => run('git', ['branch', '--show-current'], { cwd: WORKSPACE }).stdout.trim();

/** Arquivo que marca a pasta como da demo: sem ele, nada é apagado. */
const MARKER = '.shieldepy-demo';

/** Cria a pasta da demo (fora do repositório) com a marca. */
function ensureDemoDir() {
  if (existsSync(DEMO) && !existsSync(join(DEMO, MARKER)) && readdirSync(DEMO).length > 0) {
    fail(`${DEMO} já existe e não é da demo. Escolha outra pasta: DEMO_DIR=<pasta> npm run demo`);
  }
  mkdirSync(DEMO, { recursive: true });
  writeFileSync(join(DEMO, MARKER), 'Pasta da demo do ShielDepy (npm run demo). Pode apagar inteira.\n');
}

/**
 * Apaga uma pasta da demo. O `node_modules` do checkout é um link para o do exemplo: ele sai antes,
 * como link, para nunca apagar as dependências do exemplo por engano.
 */
function removeDemoDir(dir) {
  if (!existsSync(dir)) return;
  // só apaga pasta que a própria demo criou (DEMO_DIR pode apontar para qualquer lugar)
  if (!existsSync(join(DEMO, MARKER))) fail(`não apago ${DEMO}: não foi a demo que criou esta pasta (falta o arquivo ${MARKER}).`);
  for (const link of [join(dir, 'checkout', 'node_modules'), join(dir, 'sistema-loja', 'checkout', 'node_modules')]) {
    try {
      if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
    } catch {
      // não existe
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- pré-requisitos
function checkPrereqs() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 6)) fail(`precisa de Node 22.6 ou mais novo (este é ${process.version}). Baixe em https://nodejs.org`);
  ok(`Node ${process.version}`);
  if (spawnSync('git', ['--version']).status !== 0) fail('o git não foi encontrado no PATH. Instale em https://git-scm.com');
  ok('git');
}

/** O executável do VS Code (sem o `code.cmd`, que no Windows exige shell). */
function findVsCode() {
  if (process.env.VSCODE_BIN) return existsSync(process.env.VSCODE_BIN) ? process.env.VSCODE_BIN : undefined;
  const candidates = [];
  const which = spawnSync(isWin ? 'where' : 'which', ['code'], { encoding: 'utf8' });
  for (const line of (which.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    // .../Microsoft VS Code/bin/code(.cmd) → .../Microsoft VS Code/Code.exe
    candidates.push(isWin ? join(dirname(line), '..', 'Code.exe') : line);
  }
  if (isWin) {
    candidates.push(join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'), 'C:\\Program Files\\Microsoft VS Code\\Code.exe');
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
  } else {
    candidates.push('/usr/bin/code', '/snap/bin/code');
  }
  return candidates.find((p) => existsSync(p));
}

// ---------------------------------------------------------------- instalação e build
function install() {
  if (!existsSync(join(ROOT, 'node_modules', 'tsx'))) {
    console.log(dim('  instalando as dependências do ShielDepy (só na primeira vez; leva alguns minutos)...'));
    npm(['ci', '--no-audit', '--no-fund'], { show: true });
  }
  ok('dependências do ShielDepy');
  const dir = join(EXAMPLES, 'checkout-express');
  if (!existsSync(join(dir, 'node_modules', 'vitest'))) {
    console.log(dim('  instalando as dependências do checkout de exemplo...'));
    npm(['ci', '--no-audit', '--no-fund'], { cwd: dir, show: true });
  }
  ok('dependências do checkout (Vitest, MSW, PGlite)');
}

function build(force) {
  if (force || !existsSync(join(ROOT, 'apps', 'vscode', 'dist', 'extension.js'))) {
    console.log(dim('  compilando a extensão...'));
    npm(['run', 'build', '-w', 'shieldepy']);
  }
  ok('extensão compilada (apps/vscode/dist)');
  if (force || !existsSync(join(ROOT, 'apps', 'frontend', 'dist', 'app.html'))) {
    console.log(dim('  compilando o portal...'));
    npm(['run', 'build', '-w', '@shieldepy/frontend']);
  }
  ok('portal compilado (apps/frontend/dist)');
}

// ---------------------------------------------------------------- o sistema da demo
const SKIP = new Set(['node_modules', '.shieldepy', 'smoke.test.ts']);
const copyExample = (from, to) => cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(src.split(/[\\/]/).pop()) });

/** Dois módulos que se chamam um ao outro: o ciclo que o plugin acusa ao abrir o arquivo. */
const RELATORIOS = {
  'resumo.ts': `import { totalDoPeriodo } from './totais';

/** Resumo mensal de vendas, para o painel do gerente. */
export function resumoMensal(mes: number): string {
  const total = totalDoPeriodo(mes);
  return \`mês \${mes}: R$ \${total.toFixed(2)}\`;
}
`,
  'totais.ts': `import { resumoMensal } from './resumo';

/** Total vendido no mês. Defeito plantado para a demo: chama o resumo de volta (ciclo). */
export function totalDoPeriodo(mes: number): number {
  if (mes > 1) console.log('mês anterior:', resumoMensal(mes - 1));
  return mes * 100;
}
`,
};

/**
 * O sistema da loja em dois estados: `main` (com os defeitos) e `correcao` (o checkout corrigido).
 *   checkout/   API Express: estoque no Postgres e cobrança no Stripe (os testes de caos rodam aqui)
 *   pedidos/    microserviços que reagem ao mesmo evento e escrevem o mesmo campo (colisões)
 *   relatorios/ dois módulos em ciclo
 */
function prepareWorkspace() {
  if (existsSync(join(WORKSPACE, '.git'))) {
    ok(`sistema da demo já existe: ${WORKSPACE}`);
    return;
  }
  removeDemoDir(WORKSPACE);
  mkdirSync(WORKSPACE, { recursive: true });
  copyExample(join(EXAMPLES, 'checkout-express'), APP);
  copyExample(join(EXAMPLES, 'pedidos-microservices'), join(WORKSPACE, 'pedidos'));
  mkdirSync(join(WORKSPACE, 'relatorios'));
  for (const [file, content] of Object.entries(RELATORIOS)) writeFileSync(join(WORKSPACE, 'relatorios', file), content);

  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  pkg.name = 'checkout';
  writeFileSync(join(APP, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  // `npm run caos` na raiz do sistema (o terminal do VS Code abre nela)
  const root = { name: 'sistema-loja', private: true, description: 'Sistema de exemplo da demo do ShielDepy.', scripts: { caos: `node "${SELF}" --caos` } };
  writeFileSync(join(WORKSPACE, 'package.json'), `${JSON.stringify(root, null, 2)}\n`);
  writeFileSync(join(WORKSPACE, 'ROTEIRO.md'), roteiro());
  writeFileSync(join(WORKSPACE, '.gitignore'), 'node_modules/\n.shieldepy/\n.vscode/\n');
  // as dependências do checkout de exemplo, sem instalar de novo (junction no Windows, symlink no resto)
  symlinkSync(join(EXAMPLES, 'checkout-express', 'node_modules'), join(APP, 'node_modules'), isWin ? 'junction' : 'dir');
  // o plugin fala com o portal local
  mkdirSync(join(WORKSPACE, '.vscode'), { recursive: true });
  writeFileSync(join(WORKSPACE, '.vscode', 'settings.json'), `${JSON.stringify({ 'shieldepy.webBaseUrl': PORTAL }, null, 2)}\n`);

  git(['init', '--quiet', '-b', 'main']);
  git(['remote', 'add', 'origin', DEMO_REMOTE]);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'Sistema da loja: checkout, pedidos e relatórios']);

  // a branch corrigida: reserva antes de cobrar, timeout no Stripe e estorno se o pedido não gravar
  git(['switch', '--quiet', '-c', 'correcao']);
  rmSync(join(APP, 'src'), { recursive: true, force: true });
  copyExample(join(EXAMPLES, 'checkout-express-fixed', 'src'), join(APP, 'src'));
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'Corrige o checkout: reserva atômica, timeout no Stripe e estorno quando o pedido não grava']);
  git(['switch', '--quiet', 'main']);
  ok(`sistema da demo criado em ${WORKSPACE} (branches main e correcao)`);
}

// ---------------------------------------------------------------- portal
function seedPortal() {
  rmSync(PORTAL_DATA, { recursive: true, force: true });
  mkdirSync(PORTAL_DATA, { recursive: true });
  node([TSX, join('scripts', 'demo', 'seed.ts'), DEMO_REMOTE, SEED_FILE], { env: { SHIELDEPY_DATA_DIR: PORTAL_DATA } });
  ok('portal com a empresa Acme, as contas de demonstração e o projeto do sistema');
  return JSON.parse(readFileSync(SEED_FILE, 'utf8'));
}

async function portalUp() {
  try {
    const r = await fetch(`${PORTAL}/api/me`);
    return r.status === 401 || r.ok;
  } catch {
    return false;
  }
}

async function startPortal() {
  if (await portalUp()) fail(`a porta ${PORT} já está em uso. Feche o que está nela ou rode com outra porta: DEMO_PORT=3002 npm run demo`);
  const server = spawn(process.execPath, [TSX, join('server', 'server.ts')], {
    cwd: join(ROOT, 'apps', 'frontend'),
    env: { ...process.env, SHIELDEPY_DATA_DIR: PORTAL_DATA, PORT: String(PORT), PUBLIC_URL: PORTAL },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) fail(`o portal não subiu:\n${output}`);
    if (await portalUp()) {
      ok(`portal no ar: ${PORTAL}`);
      return server;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopTree(server);
  fail(`o portal não respondeu em 30 s:\n${output}`);
}

/** Encerra o processo e os filhos dele (no Windows, matar só o pai deixa o filho órfão na memória). */
function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

// ---------------------------------------------------------------- caos
/** Roda o caos (offline, sem gastar com IA) no checkout, na branch atual, e publica no portal. */
function chaos(ciToken, label) {
  const report = join(APP, '.shieldepy', 'chaos-report.md');
  const html = join(APP, '.shieldepy', 'mapa.html');
  console.log(dim(`  rodando os testes de caos (${label})... leva uns 30 s`));
  const r = node([CLI, 'chaos', APP, '--offline', '--report', report, '--html', html], { allow: [0, 1, 2] });
  const line = (r.stdout ?? '').split(/\r?\n/).find((l) => l.includes('resultado:'));
  if (r.status === 2) warn(`o caos não rodou (erro de ambiente):\n${r.stdout}${r.stderr}`);
  else ok(`${label}: ${line?.replace(/^.*resultado:\s*/, '') ?? 'concluído'} (exit ${r.status})`);
  if (ciToken) {
    const p = node([CLI, 'publish', APP, '--portal', PORTAL], { env: { SHIELDEPY_PORTAL_TOKEN: ciToken }, allow: [0, 1, 2] });
    if (p.status === 0) ok(`publicado no portal (${(p.stdout ?? '').trim().split(' ').pop()})`);
    else warn(`não publicou no portal: ${(p.stderr || p.stdout || '').trim()}`);
  }
  return r.status;
}

// ---------------------------------------------------------------- VS Code
function openVsCode(seed) {
  const code = findVsCode();
  const roteiro = join(WORKSPACE, 'ROTEIRO.md');
  const launchArgs = [
    WORKSPACE,
    roteiro,
    `--extensionDevelopmentPath=${join(ROOT, 'apps', 'vscode')}`,
    `--user-data-dir=${VSCODE_PROFILE}`,
    `--extensions-dir=${VSCODE_EXTENSIONS}`,
    '--new-window',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
  ];
  if (!code || args.has('--sem-vscode')) {
    if (!code) warn('não achei o VS Code. Instale (https://code.visualstudio.com) ou indique o executável em VSCODE_BIN.');
    console.log(`  Para abrir à mão, com a variável de ambiente SHIELDEPY_DEMO_TOKEN=${seed.deviceToken}:`);
    console.log(`  "${code ?? 'code'}" ${launchArgs.map((a) => `"${a}"`).join(' ')}`);
    return;
  }
  mkdirSync(join(VSCODE_PROFILE, 'User'), { recursive: true });
  // perfil só da demo: sem tela de boas-vindas, o ROTEIRO.md abre já formatado, e um pouco de zoom
  // para o projetor
  writeFileSync(
    join(VSCODE_PROFILE, 'User', 'settings.json'),
    `${JSON.stringify(
      {
        'security.workspace.trust.enabled': false,
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.editorAssociations': { 'ROTEIRO.md': 'vscode.markdown.preview.editor' },
        'git.openRepositoryInParentFolders': 'never',
        'extensions.ignoreRecommendations': true,
        'window.zoomLevel': Number(process.env.DEMO_ZOOM ?? 0),
      },
      null,
      2
    )}\n`
  );
  // Rodando de dentro de um VS Code (terminal integrado, extensão), o ambiente traz variáveis do
  // Electron e do VS Code (ELECTRON_RUN_AS_NODE, VSCODE_ESM_ENTRYPOINT, VSCODE_PID, ...) que fazem o
  // Code.exe novo subir como Node puro ou como host de extensão, sem janela. Saem todas.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VSCODE_|ELECTRON_|CHROME_CRASHPAD)/i.test(k)));
  env.SHIELDEPY_DEMO_TOKEN = seed.deviceToken;
  const child = spawn(code, launchArgs, { env, detached: true, stdio: 'ignore' });
  child.on('error', (err) => warn(`não consegui abrir o VS Code: ${err.message}`));
  child.unref();
  ok('VS Code aberto com o plugin ShielDepy e o ROTEIRO.md (perfil separado: não mexe no seu VS Code)');
}

// ---------------------------------------------------------------- roteiro
/** O passo a passo da apresentação: vai como ROTEIRO.md no sistema e abre sozinho no VS Code. */
function roteiro() {
  return `# Roteiro da demo do ShielDepy

O ShielDepy lê o código sem executar nada, monta o grafo do sistema, acha as rotas que fazem
operações arriscadas (banco e APIs externas) e gera testes de caos só para elas. No PR, ele barra
o que quebra sob falha.

Este sistema tem três partes:

| Pasta | O que é | O que o ShielDepy acha |
|---|---|---|
| \`checkout/\` | API Express: estoque no Postgres e cobrança no Stripe | corrida no estoque, Stripe sem timeout, cobra e não grava o pedido se o banco cair |
| \`pedidos/\` | microserviços que reagem ao mesmo evento \`order.updated\` | dois serviços escrevem o mesmo campo \`total\` |
| \`relatorios/\` | resumo e totais de vendas | um módulo chama o outro em ciclo |

Branches: **main** (com os defeitos) e **correcao** (o checkout corrigido).

> Para executar os comandos: **Ctrl+Shift+P** e digite "ShielDepy".
> O terminal fica em **Ctrl+'** (aspas simples).

---

## 1. O plugin entrou sozinho

1. Na **barra da esquerda**, clique no **ícone do escudo (ShielDepy)**.
2. A aba **Lista de erros** abre já liberada. No topo aparece o **Protetor de código**, com o projeto
   **"Sistema da loja (demo do TCC)"**. A extensão entrou no portal local com a conta \`dono@acme.test\`.
3. Para ver o plugin trabalhando: **Exibir → Saída** (Ctrl+Shift+U) e escolha **ShielDepy** na lista
   da direita. O log mostra o acesso, a indexação do grafo e cada análise.

## 2. Lista de erros: colisões entre microserviços

1. Ainda na aba **Lista de erros**, os contadores mostram **Erro / Aviso / Info**.
2. Em **Problemas** aparecem:
   - **Escrita dupla em "total" no evento order.updated**: \`pedidos/services/pricing\` e \`pedidos/services/tax\`
     reagem ao mesmo evento e escrevem o mesmo campo. A ordem é indefinida, e o total final depende de quem rodou por último;
   - **"total" é lido e escrito sem ordem garantida**: \`pedidos/services/audit\` lê o \`total\` que os outros dois escrevem.
3. Clique num problema: o editor abre no trecho exato.
4. Os mesmos achados aparecem na aba **Problemas** do VS Code (Ctrl+Shift+M).

## 3. Grafo de chamadas: um ciclo

1. Abra \`relatorios/totais.ts\`.
2. Aparece um aviso amarelo: **Ciclo de chamadas detectado** (\`totalDoPeriodo → resumoMensal → totalDoPeriodo\`).
   Passe o mouse em cima: o aviso aponta a outra função do ciclo, em \`relatorios/resumo.ts\`.

## 4. O mapa do sistema (o grafo)

1. **Ctrl+Shift+P → ShielDepy: Ver Mapa do Sistema**. Abre a aba **Mapa do sistema**:
   - à esquerda: **Caos** (resultado dos testes, lido de \`checkout/.shieldepy/chaos-results.json\`),
     **Cobertura das chamadas internas** (100% provado: nenhuma ligação adivinhada), as **rotas** e os
     filtros **Mostrar** (rotas e operações de I/O, chamadas, imports, pacotes);
   - no centro: o grafo inteiro, com arquivos, funções, classes, pacotes (\`pg\`, \`express\`) e as
     operações de banco e de API.
2. No painel **Caos**: **Bloqueado: 6 achado(s)**. Cada cartão mostra a falha injetada, a invariante
   que quebrou e o arquivo do teste gerado.
3. Clique em **POST /checkout**, na lista de rotas ou no grafo. Abre o **fluxo da rota**: requisição →
   controller → service → repositórios → \`db_read stock\` → \`api_call api.stripe.com\` → \`db_write\`.
   A rota fica vermelha (\`✖\`), e as operações atingidas pelo caos ficam com borda vermelha.
4. Clique num nó (ex.: \`CheckoutService.checkout\`): o painel de detalhes mostra os botões **Cadeia abaixo**,
   **Quem chega aqui** e **Abrir código**, que abre o editor na função. **Voltar ao mapa** volta ao grafo inteiro.

## 5. Topologia: o que vai para a IA

1. **Ctrl+Shift+P → ShielDepy: Exportar Topologia**.
2. Abre \`.shieldepy/topology-graph.json\`: cada rota com as operações de I/O em ordem e as tags de
   risco (\`read-then-write\`, \`no-timeout\`, \`write-after-api-call\`). É só isto que a IA vê, nunca o código.

## 6. A correção, como num pull request

No terminal (Ctrl+'):

\`\`\`
git switch correcao
npm run caos
\`\`\`

- O \`npm run caos\` gera os testes de caos de novo, roda com o Vitest e publica no portal. Leva uns 30 s.
- Resultado: **0 achados**. A corrida, o timeout, o 5xx, o corpo inválido e a falha parcial **aguentam**.
- O **Mapa do sistema** aberto atualiza sozinho: a rota fica verde (\`✓\`).

## 7. O que a correção mudou

1. **Ctrl+Shift+P → ShielDepy: Comparar Mapa com uma Branch** → digite \`main\`.
2. O mapa marca o que mudou desde a \`main\`:
   - símbolos novos: \`StripeGateway.refund\`, \`StockRepository.reserve\`, \`StockRepository.release\` e \`OrderNotSavedError\`;
   - corpos alterados: \`CheckoutService.checkout\`, \`StripeGateway.charge\`;
   - as rotas que a mudança tocou.
3. A seção **Mudanças do PR** lista tudo, e o filtro **só o que o PR mudou (e os vizinhos)**, em **Mostrar**, deixa no grafo só essa parte.

## 8. O portal (o histórico do CI)

1. Abra **${PORTAL}** no navegador e entre com \`dono@acme.test\` / \`Acme-Dono-2026\`.
2. Entre em **Projetos → Sistema da loja (demo do TCC)**. O painel **Caos no CI** tem o histórico do repositório.
3. Clique numa execução. Cada rota aparece como **linha do tempo** das operações, com a estação atingida
   marcada ("Falha parcial" em **grava orders**, "Corrida" em **lê stock**), a invariante violada e o teste.

## 9. Voltar ao começo

\`\`\`
git switch main
npm run caos
\`\`\`

O mapa volta a mostrar os 6 achados. Os arquivos gerados ficam em \`checkout/.shieldepy/\`:
- \`chaos-report.md\`: o comentário que iria no PR;
- \`mapa.html\`: o mapa, para abrir no navegador;
- \`chaos-tests/\`: os testes gerados;
- \`chaos-results.json\`: o que o plugin e o portal leem.

---

**Abas do plugin:**
- **Escudo**, na barra da esquerda: Lista de erros;
- **Engrenagem do ShielDepy**, na barra da esquerda: Configurações (conta, empresa, chave da IA);
- **Chat do ShielDepy**, na barra da direita: perguntas sobre os achados. Precisa de chave da IA,
  em **ShielDepy: Configurar Chave da IA**. A demo roda sem IA: as hipóteses e os testes vêm do motor.
`;
}

function printSummary(seed) {
  console.log(`
${bold('══════════════════════ ShielDepy — demo pronta ══════════════════════')}

${bold('Sistema:')} ${WORKSPACE}
${bold('Portal:')}  ${PORTAL}   login ${bold(seed.owner.email)} / ${bold(seed.owner.password)}

O passo a passo está no ${bold('ROTEIRO.md')}, que abriu no VS Code (também em ${join(WORKSPACE, 'ROTEIRO.md')}).
Resumo: escudo na barra da esquerda → Lista de erros · relatorios/totais.ts → ciclo ·
Ctrl+Shift+P → "ShielDepy: Ver Mapa do Sistema" → grafo e caos · no terminal:
git switch correcao + npm run caos · "ShielDepy: Comparar Mapa com uma Branch" → main.

${dim('Deixe este terminal aberto: ele mantém o portal no ar. Ctrl+C encerra o portal.')}
`);
}

// ---------------------------------------------------------------- comandos
async function main() {
  if (args.has('--caos')) {
    if (!existsSync(join(WORKSPACE, '.git'))) fail('a demo ainda não foi preparada. Rode antes: npm run demo');
    const seed = existsSync(SEED_FILE) ? JSON.parse(readFileSync(SEED_FILE, 'utf8')) : undefined;
    const up = await portalUp();
    if (!up) warn(`o portal não está no ar (${PORTAL}): o resultado não será publicado. Ele sobe com npm run demo.`);
    chaos(up ? seed?.ciToken : undefined, `branch ${currentBranch()}`);
    console.log(`\n  relatório: ${join(APP, '.shieldepy', 'chaos-report.md')}`);
    return;
  }

  console.log(bold('\n🛡️  ShielDepy — preparando a demo'));
  if (args.has('--do-zero')) {
    removeDemoDir(DEMO);
    ok(`pasta da demo apagada (${DEMO})`);
  }
  ensureDemoDir();
  console.log(dim(`  pasta da demo (fora do repositório): ${DEMO}`));
  const TOTAL = 6;
  step(1, TOTAL, 'Pré-requisitos');
  checkPrereqs();
  step(2, TOTAL, 'Dependências');
  install();
  step(3, TOTAL, 'Compilação');
  build(args.has('--do-zero') || args.has('--compilar'));
  step(4, TOTAL, 'Sistema da demo (checkout, pedidos e relatórios)');
  prepareWorkspace();
  step(5, TOTAL, 'Portal local e testes de caos');
  const seed = seedPortal();
  const server = await startPortal();
  // o portal nunca fica órfão: sai junto com o script, seja por Ctrl+C, erro ou fim
  const stop = () => {
    stopTree(server);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  process.on('exit', () => stopTree(server));
  // o histórico do portal (o banco é novo a cada execução): a correção aguenta e a main é barrada.
  // A main fica por último porque é a branch aberta no VS Code, e o resultado dela é o que o plugin mostra.
  if (run('git', ['status', '--porcelain'], { cwd: WORKSPACE }).stdout.trim()) {
    warn('o sistema da demo tem mudanças não commitadas: rodando o caos só na branch atual');
    chaos(seed.ciToken, `branch ${currentBranch()}`);
  } else {
    const start = currentBranch();
    for (const branch of ['correcao', 'main'].filter((b) => b !== start).concat(start)) {
      git(['switch', '--quiet', branch]);
      chaos(seed.ciToken, `branch ${branch}`);
    }
  }
  step(6, TOTAL, 'VS Code');
  openVsCode(seed);
  printSummary(seed);
  // mantém o portal no ar até o Ctrl+C
  await new Promise(() => {});
}

await main();
