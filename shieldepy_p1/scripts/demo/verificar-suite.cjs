// Roda DENTRO de um VS Code de teste aberto no sistema da demo (ver verificar.mjs): percorre o
// ROTEIRO.md sem ninguém clicar e falha no primeiro passo que não acontecer como o roteiro diz.
const vscode = require('vscode');
const path = require('path');
const { execFileSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, ms = 60000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`timeout: ${label}`);
    await sleep(300);
  }
}
async function step(label, fn) {
  try {
    const extra = await fn();
    console.log(`  ✓ ${label}${extra ? `: ${extra}` : ''}`);
  } catch (err) {
    console.log(`  ✗ ${label}`);
    throw err;
  }
}
const ours = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => String(d.source).startsWith('ShielDepy'));

exports.run = async function () {
  const ws = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const file = (rel) => vscode.Uri.file(path.join(ws, rel));
  // o --caos roda com o Node de verdade, sem as variáveis do Electron deste processo
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VSCODE_|ELECTRON_|CHROME_CRASHPAD)/i.test(k)));
  const caos = () => execFileSync('node', [process.env.DEMO_SCRIPT, '--caos'], { cwd: ws, env, encoding: 'utf8' });
  const gitSwitch = (b) => execFileSync('git', ['switch', '--quiet', b], { cwd: ws });
  let api;

  console.log('\nDemo do ShielDepy — o roteiro, passo a passo');

  await step('1. o plugin entra sozinho no portal e indexa o sistema (100% provado)', async () => {
    api = await vscode.extensions.getExtension('shieldepy.shieldepy').activate();
    await waitFor('indexação', () => api.graphStats().callsResolved > 0);
    let last = '';
    let stable = 0;
    for (let i = 0; i < 120 && stable < 8; i++) {
      const s = JSON.stringify(api.graphStats());
      stable = s === last ? stable + 1 : 0;
      last = s;
      await sleep(500);
    }
    const s = api.graphStats();
    if (s.callsUnresolved || s.callsHeuristic || s.importsUnresolved) throw new Error(`mapa não está 100%: ${JSON.stringify(s)}`);
    return `${s.callsResolved} chamadas provadas, 0 por nome, 0 sem alvo`;
  });

  await step('2. Lista de erros: as colisões dos microserviços de pedidos', async () => {
    const pricing = file('pedidos/services/pricing/handlers.ts');
    const d = await waitFor('escrita dupla em pricing', () => ours(pricing).find((x) => x.message.includes('Escrita dupla')));
    const audit = await waitFor('leitura em audit', () => ours(file('pedidos/services/audit/handlers.ts'))[0]);
    return `"${d.message}" e "${audit.message}"`;
  });

  await step('3. o ciclo em relatorios/totais.ts aparece ao abrir o arquivo', async () => {
    const totais = file('relatorios/totais.ts');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(totais));
    const d = await waitFor('aviso de ciclo', () => ours(totais).find((x) => x.message.includes('Ciclo')), 30000);
    return d.message;
  });

  await step('4. Ver Mapa do Sistema: o grafo com o caos por cima (6 achados na main)', async () => {
    await vscode.commands.executeCommand('shieldepy.showMap');
    const chaos = await waitFor('caos no mapa', () => api.lastOverlay()?.chaos, 15000);
    const failed = chaos.outcomes.filter((o) => o.status === 'failed');
    if (failed.length !== 6) throw new Error(`esperava 6 achados, veio ${failed.length}`);
    const map = api.lastMap();
    return `${map.nodes.length} nós, ${map.edges.length} arestas; ${[...new Set(failed.map((o) => o.failure))].join(', ')}`;
  });

  await step('5. Exportar Topologia', async () => {
    await vscode.commands.executeCommand('shieldepy.exportTopology');
    const t = await waitFor('topologia', () => api.lastTopology(), 15000);
    return t.routes.map((r) => r.id).join(', ');
  });

  try {
    await step('6. git switch correcao + npm run caos: aguenta, e o mapa aberto atualiza sozinho', async () => {
      gitSwitch('correcao');
      const out = caos();
      await waitFor('mapa com 0 achados', () => api.lastOverlay()?.chaos?.hits === 0, 30000);
      return out.split('\n').find((l) => l.includes('branch correcao'))?.trim();
    });

    await step('7. Comparar Mapa com uma Branch → main: o que a correção mudou', async () => {
      const r = await waitFor('diff contra a main', async () => {
        const d = await api.compareMap('main');
        return d && d.diff.symbols.added.length > 0 ? d : undefined;
      });
      const novos = r.diff.symbols.added.map((s) => s.split('#')[1]);
      if (novos.some((n) => /breakFirstWrite|healthy|stateCheck/.test(n))) throw new Error(`testes gerados entraram no diff: ${novos.join(', ')}`);
      return `novos: ${novos.join(', ')}; rotas tocadas: ${r.routes.affected.map((a) => a.id).join(', ')}`;
    });
  } finally {
    // 9. volta ao começo, para a demo ficar pronta de novo
    gitSwitch('main');
    caos();
  }
};
