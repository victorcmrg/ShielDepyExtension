// Roda DENTRO de um VS Code de teste aberto no sistema da demo (ver verificar.mjs): percorre o
// ROTEIRO.md pelos botões do plugin, sem ninguém clicar, e falha no primeiro passo que não
// acontecer como o roteiro diz.
const vscode = require('vscode');
const fs = require('fs');
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
  const gitSwitch = (b) => execFileSync('git', ['switch', '--quiet', b], { cwd: ws });
  const orders = path.join(ws, 'checkout', 'src', 'repositories', 'OrderRepository.ts');
  const caosIn = (fsPath) => api.findingsOf(fsPath).filter((f) => f.source === 'caos');
  let api;

  console.log('\nDemo do ShielDepy — o roteiro, pelos botões do plugin');

  await step('0. o plugin entra sozinho no portal e indexa o sistema (100% provado)', async () => {
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
    if (fs.existsSync(path.join(ws, 'checkout', '.shieldepy', 'chaos-results.json'))) throw new Error('a demo deveria abrir sem resultado de caos (quem roda é o botão)');
    return `${s.callsResolved} chamadas provadas, 0 por nome, 0 sem alvo; sem resultado de caos ainda`;
  });

  await step('1. Lista de erros: as colisões dos pedidos e o ciclo dos relatórios', async () => {
    const d = await waitFor('escrita dupla em pricing', () => ours(file('pedidos/services/pricing/handlers.ts')).find((x) => x.message.includes('Escrita dupla')));
    const totais = file('relatorios/totais.ts');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(totais));
    const c = await waitFor('aviso de ciclo', () => ours(totais).find((x) => x.message.includes('Ciclo')), 30000);
    return `"${d.message}" · "${c.message}"`;
  });

  await step('2. botão ◇ Ver grafo do sistema', async () => {
    await vscode.commands.executeCommand('shieldepy.showMap');
    const map = await waitFor('mapa', () => api.lastMap(), 15000);
    return `${map.nodes.length} nós, ${map.edges.length} arestas`;
  });

  await step('3. botão ⚡ Rodar testes de caos: acusa os erros na linha certa e o grafo final mostra o que quebrou', async () => {
    // o mesmo que o botão roda, sem as perguntas (todas as rotas, motor grátis)
    const summary = await api.chaos.execute(path.join(ws, 'checkout'), { offline: true });
    const chaos = await waitFor('caos no mapa', () => api.lastOverlay()?.chaos, 30000);
    const failed = chaos.outcomes.filter((o) => o.status === 'failed');
    if (failed.length !== 6) {
      const brief = chaos.outcomes.map((o) => `${o.failure}/${o.target}: ${o.status} ${o.message ?? ''}`).join('\n    ');
      throw new Error(`esperava 6 falhas, veio ${failed.length}. Resumo: ${JSON.stringify(summary)}\n    ${brief}`);
    }
    const partial = await waitFor('erro de caos no OrderRepository', () => caosIn(orders).find((f) => f.message.startsWith('Falha parcial')), 15000);
    const diag = ours(vscode.Uri.file(orders)).find((x) => x.source === 'ShielDepy (caos)');
    if (!diag) throw new Error('o erro de caos não chegou ao Problems');
    return `6 falhas; OrderRepository.ts:${partial.line + 1} "${partial.message.slice(0, 70)}…"; Problems: ${diag.severity === vscode.DiagnosticSeverity.Error ? 'erro' : diag.severity}`;
  });

  await step('4. Exportar Topologia', async () => {
    await vscode.commands.executeCommand('shieldepy.exportTopology');
    const t = await waitFor('topologia', () => api.lastTopology(), 15000);
    return t.routes.map((r) => r.id).join(', ');
  });

  try {
    await step('5. git switch correcao + ⚡ de novo: aguenta, e os erros de caos somem', async () => {
      gitSwitch('correcao');
      await api.chaos.execute(path.join(ws, 'checkout'), { offline: true });
      await waitFor('mapa com 0 falhas', () => api.lastOverlay()?.chaos?.hits === 0, 30000);
      await waitFor('erros de caos sumirem', () => caosIn(orders).length === 0, 15000);
      const chaos = api.lastOverlay().chaos;
      return `${chaos.outcomes.filter((o) => o.status === 'passed').length} aguentaram, 0 falhas`;
    });

    await step('6. Comparar Mapa com uma Branch → main: o que a correção mudou', async () => {
      const r = await waitFor('diff contra a main', async () => {
        const d = await api.compareMap('main');
        return d && d.diff.symbols.added.length > 0 ? d : undefined;
      });
      const novos = r.diff.symbols.added.map((s) => s.split('#')[1]);
      if (novos.some((n) => /breakFirstWrite|healthy|stateCheck/.test(n))) throw new Error(`testes gerados entraram no diff: ${novos.join(', ')}`);
      return `novos: ${novos.join(', ')}; rotas tocadas: ${r.routes.affected.map((a) => a.id).join(', ')}`;
    });
  } finally {
    // volta ao começo: main, sem resultado de caos
    gitSwitch('main');
    fs.rmSync(path.join(ws, 'checkout', '.shieldepy'), { recursive: true, force: true });
  }
};
