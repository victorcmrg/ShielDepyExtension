// Roda DENTRO do Extension Host (tem acesso à API `vscode` real). Sem framework: cada checagem
// imprime ✓/✗ e a primeira falha derruba a suíte com a mensagem.
const vscode = require('vscode');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, predicate, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando: ${label}`);
    await sleep(250);
  }
}

function ours(uri, source) {
  return vscode.languages.getDiagnostics(uri).filter((d) => (source ? d.source === source : String(d.source).startsWith('ShielDepy')));
}

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (err) {
    console.log(`  ✗ ${label}`);
    throw err;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const file = (rel) => vscode.Uri.file(path.join(root, rel));
  const COLISAO = 'ShielDepy (colisão)';

  console.log('\nShielDepy E2E — dentro de um VS Code real');

  let api;
  await check('a extensão ativa', async () => {
    const ext = vscode.extensions.getExtension('shieldepy.shieldepy');
    assert(ext, 'extensão não encontrada');
    api = await ext.activate();
    assert(ext.isActive, 'não ativou');
    assert(api && typeof api.signInWithToken === 'function', 'API de teste não exposta em ExtensionMode.Test');
  });

  await check('comandos registrados', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ['shieldepy.explainCollisions', 'shieldepy.scanWorkspace', 'shieldepy.reviewImpact', 'shieldepy.setApiKey', 'shieldepy.refreshAccess', 'shieldepy.openDashboard', 'shieldepy.showMap', 'shieldepy.exportTopology', 'shieldepy.runChaos', 'shieldepy.gettingStarted']) {
      assert(all.includes(c), `faltando ${c}`);
    }
  });

  await check('R2: os primeiros passos estão registrados (4 passos, mídia no pacote) e o comando abre', async () => {
    const ext = vscode.extensions.getExtension('shieldepy.shieldepy');
    const walkthrough = (ext.packageJSON.contributes.walkthroughs || []).find((w) => w.id === 'start');
    assert(walkthrough && walkthrough.steps.length === 4, 'walkthrough "start" com 4 passos');
    for (const step of walkthrough.steps) {
      assert(require('fs').existsSync(path.join(ext.extensionPath, step.media.markdown)), `mídia ausente: ${step.media.markdown}`);
      assert(/\(command:shieldepy\.[\w.]+\)/.test(step.description), `passo ${step.id} sem botão de comando`);
    }
    await vscode.commands.executeCommand('shieldepy.gettingStarted');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  const pricing = file('services/pricing/handlers.ts');
  const tax = file('services/tax/handlers.ts');
  const audit = file('services/audit/handlers.ts');
  const shipping = file('services/shipping/handlers.ts');
  const setCompanyAccess = (enabled) =>
    fetch(`${process.env.SHIELDEPY_E2E_ACCOUNT_URL}/__e2e/access`, { method: 'POST', body: JSON.stringify({ enabled }) });

  await check('sem login (modo local), as colisões já aparecem', async () => {
    assert(api.aiBlock() === null, `sem conta não há política de empresa: ${api.aiBlock()}`);
    await waitFor('colisão em pricing sem login', () => ours(pricing, COLISAO).some((x) => x.message.includes('Escrita dupla')));
  });

  await check('login com acesso liberado: a política de IA da empresa passa a valer', async () => {
    const state = await api.signInWithToken(process.env.SHIELDEPY_E2E_TOKEN);
    assert(state === 'active', `estado inesperado: ${state}`);
    // o servidor falso não libera a IA (aiEnabled: false)
    assert(api.aiBlock() === 'aiDisabled', `bloqueio de IA inesperado: ${api.aiBlock()}`);
  });

  await check('a extensão identifica o repositório pelo .git (remote + branch) ao liberar', async () => {
    const sent = await (await fetch(`${process.env.SHIELDEPY_E2E_ACCOUNT_URL}/__e2e/last-repo-check`)).json();
    const repo = (sent.repos || [])[0] || {};
    assert(repo.remote === 'https://github.com/e2e/pedidos.git', `remote enviado: ${repo.remote}`);
    assert(repo.branch === 'main', `branch enviada: ${repo.branch}`);
  });

  await check('escrita dupla em "total" aparece como ERRO em pricing E em tax (sem abrir os arquivos)', async () => {
    for (const uri of [pricing, tax]) {
      const d = await waitFor(`diagnóstico em ${uri.fsPath}`, () =>
        ours(uri, COLISAO).find((x) => x.severity === vscode.DiagnosticSeverity.Error && x.message.includes('Escrita dupla'))
      );
      assert(d.message.includes('"total"'), `mensagem inesperada: ${d.message}`);
      assert(d.relatedInformation && d.relatedInformation.length === 1, 'sem relatedInformation apontando a outra ponta');
    }
  });

  await check('audit recebe as 2 colisões read-after-write (aviso)', async () => {
    const list = await waitFor('read-after-write em audit', () => {
      const l = ours(audit, COLISAO).filter((x) => x.severity === vscode.DiagnosticSeverity.Warning);
      return l.length === 2 ? l : undefined;
    });
    assert(list.every((d) => d.message.includes('"total"')), 'campo errado');
  });

  await check('Explorer marca os arquivos com a forma e a cor da severidade (quadrado vermelho em pricing)', async () => {
    const d = await waitFor('decoração de pricing', () => {
      const x = api.decorationFor(pricing.fsPath);
      return x && x.badge === '■' ? x : undefined;
    });
    assert(d.color === 'shieldepy.importantForeground', `cor inesperada: ${d.color}`);
    assert(d.propagate === true, 'a pasta deveria herdar a cor');
    assert(/importante/i.test(d.tooltip || ''), `tooltip inesperado: ${d.tooltip}`);
    assert(api.decorationFor(shipping.fsPath) === undefined, 'shipping não tem achado e não deveria ser marcado');
  });

  await check('shipping (campo exclusivo) NÃO é acusado', async () => {
    assert(ours(shipping, COLISAO).length === 0, 'falso positivo em shipping');
  });

  await check('ciclo a.ts → b.ts → a.ts aparece ao abrir o arquivo', async () => {
    await vscode.window.showTextDocument(file('a.ts'));
    const d = await waitFor('diagnóstico de ciclo', () => ours(file('a.ts'), 'ShielDepy (grafo)').find((x) => x.message.includes('Ciclo')));
    assert(d.severity === vscode.DiagnosticSeverity.Warning, 'ciclo deveria ser aviso');
  });

  await check('o ciclo aponta pra outra função envolvida (o hover mostra o código dela)', async () => {
    const d = ours(file('a.ts'), 'ShielDepy (grafo)').find((x) => x.message.includes('Ciclo'));
    assert(d && d.relatedInformation && d.relatedInformation.some((r) => r.location.uri.fsPath.endsWith('b.ts')), 'ciclo deveria apontar pra b.ts');
  });

  await check('trocar o idioma pra inglês traduz o Explorer na hora (e voltar restaura)', async () => {
    const cfg = vscode.workspace.getConfiguration('shieldepy');
    await cfg.update('language', 'en-US', vscode.ConfigurationTarget.Global);
    try {
      await waitFor('dica em inglês', () => /Important/.test((api.decorationFor(pricing.fsPath) || {}).tooltip || ''), 5000);
    } finally {
      await cfg.update('language', undefined, vscode.ConfigurationTarget.Global);
    }
    await waitFor('dica em português', () => /Importante/.test((api.decorationFor(pricing.fsPath) || {}).tooltip || ''), 5000);
  });

  await check('editar tax pra escrever outro campo DESFAZ a colisão nos dois arquivos (ao vivo)', async () => {
    const doc = await vscode.workspace.openTextDocument(tax);
    await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(tax, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), text.replace('order.total =', 'order.taxTotal ='));
    assert(await vscode.workspace.applyEdit(edit), 'edição não aplicada');
    await waitFor('colisão sumir de pricing', () => !ours(pricing, COLISAO).some((x) => x.message.includes('Escrita dupla')), 15000);
    await waitFor('colisão sumir de tax', () => ours(tax, COLISAO).length === 0, 15000);
  });

  await check('"Explicar Colisões" gera o relatório offline em markdown', async () => {
    await vscode.commands.executeCommand('shieldepy.explainCollisions');
    const editor = await waitFor('relatório aberto', () => {
      const e = vscode.window.visibleTextEditors.find((x) => x.document.languageId === 'markdown');
      return e && e.document.getText().includes('Colisões do workspace') ? e : undefined;
    });
    assert(editor.document.getText().includes('offline'), 'deveria ter sido gerado pelo explicador offline');
  });

  let auditBefore = 0;
  await check('empresa suspensa: só a IA desliga; ciclos e colisões continuam', async () => {
    assert(ours(file('a.ts')).length > 0, 'pré-condição: ciclo ainda deveria estar publicado');
    auditBefore = ours(audit, COLISAO).length;
    assert(auditBefore > 0, 'pré-condição: audit deveria ter colisões');
    await setCompanyAccess(false);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('IA desligada pela suspensão', () => api.aiBlock() === 'suspended', 10000);
    await sleep(2000);
    assert(ours(file('a.ts'), 'ShielDepy (grafo)').some((x) => x.message.includes('Ciclo')), 'o ciclo sumiu com a suspensão');
    assert(ours(audit, COLISAO).length === auditBefore, 'as colisões sumiram com a suspensão');
  });

  await check('suspenso: editar um arquivo ainda gera análise local', async () => {
    const doc = await vscode.workspace.openTextDocument(file('b.ts'));
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount, 0), '// edição durante a suspensão\n');
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    await waitFor('ciclo em b.ts', () => ours(file('b.ts'), 'ShielDepy (grafo)').some((x) => x.message.includes('Ciclo')), 15000);
  });

  await check('acesso liberado de novo: a política volta a ser a da empresa', async () => {
    await setCompanyAccess(true);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('bloqueio voltar a ser o da IA não liberada', () => api.aiBlock() === 'aiDisabled', 10000);
    assert(ours(audit, COLISAO).length === auditBefore, 'colisões de audit mudaram');
  });

  const setRepoAllowed = (allowed) =>
    fetch(`${process.env.SHIELDEPY_E2E_ACCOUNT_URL}/__e2e/repo`, { method: 'POST', body: JSON.stringify({ allowed }) });

  await check('repositório tirado do projeto: só a IA desliga; os achados locais ficam', async () => {
    await setRepoAllowed(false);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('IA desligada pelo repositório', () => api.aiBlock() === 'repoBlocked', 10000);
    await sleep(2000);
    assert(ours(file('a.ts'), 'ShielDepy (grafo)').some((x) => x.message.includes('Ciclo')), 'o ciclo sumiu');
    assert(ours(audit, COLISAO).length === auditBefore, 'as colisões sumiram');
  });

  await check('repositório conectado de novo: a política volta a ser a da empresa', async () => {
    await setRepoAllowed(true);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('bloqueio voltar a ser o da IA não liberada', () => api.aiBlock() === 'aiDisabled', 10000);
  });

  // --- mapa do sistema (E1 dentro do editor) ---------------------------------------------
  const edgeIn = (map, source, target, type) =>
    map.edges.some((e) => e.source.startsWith(source) && e.target.startsWith(target) && e.type === type);

  await check('o mapa do workspace sai 100% provado (sem import quebrado, sem chamada sem alvo)', async () => {
    const stats = await waitFor('indexação com o checkout', () => {
      const s = api.graphStats();
      return s.callsResolved > 0 ? s : undefined;
    });
    assert(stats.callsUnresolved === 0, `chamadas sem alvo: ${stats.callsUnresolved}`);
    assert(stats.callsHeuristic === 0, `chamadas por heurística: ${stats.callsHeuristic}`);
    assert(stats.importsUnresolved === 0, `imports quebrados: ${stats.importsUnresolved}`);
  });

  await check('"Ver Mapa do Sistema" abre o painel com a cadeia rota → controller → service → repositórios → pg', async () => {
    await vscode.commands.executeCommand('shieldepy.showMap');
    const labels = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label);
    await waitFor(`painel do mapa abrir (abas: ${labels().join(', ')}; mapa gerado: ${!!api.lastMap()})`, () => labels().includes('Mapa do sistema'), 10000);
    const map = api.lastMap();
    assert(map && map.contentHash, 'mapa não foi gerado');
    const c = 'checkout/src/';
    assert(edgeIn(map, `${c}routes/checkout.ts`, `${c}controllers/CheckoutController.ts#CheckoutController.create`, 'references'), 'rota → controller');
    assert(edgeIn(map, `${c}controllers/CheckoutController.ts#CheckoutController.create`, `${c}services/CheckoutService.ts#CheckoutService.checkout`, 'calls'), 'controller → service');
    assert(edgeIn(map, `${c}services/CheckoutService.ts#CheckoutService.checkout`, `${c}gateways/StripeGateway.ts#StripeGateway.charge`, 'calls'), 'service → Stripe (pela interface)');
    assert(edgeIn(map, `${c}repositories/StockRepository.ts#StockRepository.decrement`, 'pkg:pg', 'calls'), 'repositório → pg');
  });

  await check('"Exportar Topologia" grava .shieldepy/topology-graph.json com POST /checkout em ordem e as tags', async () => {
    await vscode.commands.executeCommand('shieldepy.exportTopology');
    const disk = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(file('.shieldepy/topology-graph.json'))).toString('utf8'));
    const topology = api.lastTopology();
    assert(topology && topology.contentHash === disk.contentHash, 'arquivo diferente da topologia em memória');
    const checkout = disk.routes.find((r) => r.id === 'POST /checkout');
    assert(checkout, `rotas: ${disk.routes.map((r) => r.id).join(', ')}`);
    const ops = checkout.operations.map((o) => `${o.kind} ${o.target}`).join(' → ');
    assert(ops === 'db_read stock → api_call api.stripe.com → db_write stock → db_write orders', `operações: ${ops}`);
    const tags = checkout.tags.map((t) => t.tag);
    for (const t of ['read-then-write', 'write-after-api-call', 'no-timeout', 'no-transaction']) assert(tags.includes(t), `faltando a tag ${t}: ${tags}`);
    assert(checkout.file === 'checkout/src/routes/checkout.ts' && checkout.confidence === 'proven', `rota: ${checkout.file} ${checkout.confidence}`);
    // o painel do mapa recebe a mesma topologia (rotas viram nós no editor)
    await vscode.commands.executeCommand('shieldepy.showMap');
    assert(api.lastTopology().routes.some((r) => r.id === 'POST /checkout'), 'painel do mapa sem a topologia');
  });

  // V2d: o resultado do `shieldepy chaos` aparece por cima do mapa, e o painel se atualiza sozinho
  const chaosResults = (hits, status) => ({
    version: 1,
    project: 'checkout',
    topologyHash: 'outra-raiz',
    engine: 'offline',
    ran: true,
    failOn: 'Baixo',
    hits,
    outcomes: [
      {
        hypothesisId: 'POST /checkout__race_condition__stock',
        routeId: 'POST /checkout',
        failure: 'race_condition',
        target: 'stock',
        status,
        ...(status === 'failed' && { severity: 'Crítico', message: 'stateCheck: stockNeverNegative' }),
        durationMs: 200,
        testFile: '.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts',
      },
    ],
    untested: [],
    cost: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, usd: 0, unpriced: [], withoutUsage: 0 },
  });
  const resultsFile = file('checkout/.shieldepy/chaos-results.json');
  const writeResults = (r) => vscode.workspace.fs.writeFile(resultsFile, Buffer.from(JSON.stringify(r)));

  await check('V2d: o resultado do caos (.shieldepy/chaos-results.json) aparece no painel do mapa', async () => {
    await writeResults(chaosResults(1, 'failed'));
    await vscode.commands.executeCommand('shieldepy.showMap');
    await waitFor('overlay do caos no painel', () => api.lastOverlay() && api.lastOverlay().chaos, 10000);
    const chaos = api.lastOverlay().chaos;
    assert(chaos.project === 'checkout' && chaos.hits === 1, `resultado: ${chaos.project} ${chaos.hits}`);
    assert(chaos.outcomes[0].status === 'failed' && chaos.outcomes[0].routeId === 'POST /checkout', 'achado não chegou');
    // escrito agora: mais novo que o código do projeto (o hash não serve, a raiz é outra)
    assert(chaos.stale === false, 'resultado recém-escrito marcado como desatualizado');
  });

  await check('V2d: rodar o caos de novo (arquivo novo) atualiza o painel aberto sozinho', async () => {
    await writeResults(chaosResults(0, 'passed'));
    await waitFor('painel atualizar com o resultado novo', () => api.lastOverlay().chaos && api.lastOverlay().chaos.hits === 0, 10000);
    assert(api.lastOverlay().chaos.outcomes[0].status === 'passed', 'status não atualizou');
  });

  await check('V2d: "Comparar mapa com uma branch" mostra o diff do PR e a rota tocada', async () => {
    const gateway = file('checkout/src/gateways/StripeGateway.ts');
    const original = Buffer.from(await vscode.workspace.fs.readFile(gateway)).toString('utf8');
    assert(original.includes("currency: 'brl'"), 'exemplo mudou: falta currency brl');
    await vscode.workspace.fs.writeFile(gateway, Buffer.from(original.split("currency: 'brl'").join("currency: 'usd'")));
    try {
      const charge = 'checkout/src/gateways/StripeGateway.ts#StripeGateway.charge';
      let result;
      await waitFor('o diff ver o corpo novo do charge', async () => {
        result = await api.compareMap('HEAD');
        return result && result.diff.symbols.changed.includes(charge);
      }, 30000);
      assert(result.routes.affected.some((a) => a.id === 'POST /checkout'), `rotas tocadas: ${JSON.stringify(result.routes.affected)}`);
      assert(!result.routes.affected.some((a) => a.id === 'GET /orders/:id'), 'GET /orders/:id não deveria ser tocada');
      assert(api.lastOverlay().diff && api.lastOverlay().diff.base === 'HEAD', 'o painel não recebeu o diff');
      // o caos continua no painel junto com o diff
      assert(api.lastOverlay().chaos, 'o resultado do caos sumiu do painel');
    } finally {
      await vscode.workspace.fs.writeFile(gateway, Buffer.from(original));
      await vscode.workspace.fs.delete(resultsFile);
    }
  });

  // --- "Testar Caos" no editor (R3) -----------------------------------------------------
  const checkoutRoot = path.join(root, 'checkout');

  await check('R3: "Testar Caos" acha o checkout (rotas sensíveis no mapa, contrato pronto)', async () => {
    const all = await vscode.commands.getCommands(true);
    assert(all.includes('shieldepy.runChaos'), 'comando shieldepy.runChaos não registrado');
    const found = api.chaos.projects().find((p) => p.root === checkoutRoot);
    assert(found, `projetos: ${JSON.stringify(api.chaos.projects())}`);
    assert(found.routes >= 1 && found.hasContract, `checkout: ${JSON.stringify(found)}`);
  });

  await check('R3: sem node_modules, aponta os pacotes que os testes de caos usam', async () => {
    const missing = api.chaos.missingPackages(checkoutRoot);
    assert(missing.join(',') === 'vitest,supertest,msw', `faltando: ${missing}`);
  });

  await check('R3: sem contrato, cria um a partir do mapa (o bundle do caos carrega no editor)', async () => {
    const contract = file('checkout/shieldepy.chaos.config.ts');
    const original = await vscode.workspace.fs.readFile(contract);
    await vscode.workspace.fs.delete(contract);
    try {
      assert(api.chaos.projects().find((p) => p.root === checkoutRoot)?.hasContract === false, 'ainda vê o contrato apagado');
      assert((await api.chaos.createContract(checkoutRoot)) === true, 'createContract falhou (veja o canal ShielDepy)');
      const text = Buffer.from(await vscode.workspace.fs.readFile(contract)).toString('utf8');
      assert(text.includes("'POST /checkout': { path: '/checkout', body: {} }"), `contrato:\n${text}`);
      assert(text.includes("'api.stripe.com'") && text.includes('TODO(shieldepy)'), 'faltou a API ou as marcas de pendência');
    } finally {
      await vscode.workspace.fs.writeFile(contract, original);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  // Prova real (só quando o exemplo tem `npm install`): o caos roda no editor, com o Vitest do
  // projeto no Node do VS Code (ELECTRON_RUN_AS_NODE), e barra a corrida e o timeout do Stripe.
  const example = path.join(__dirname, '..', '..', '..', 'examples', 'checkout-express');
  if (require('fs').existsSync(path.join(example, 'node_modules', 'vitest'))) {
    await check('R3: o caos roda de verdade no editor e prova a corrida e o timeout (exit 1)', async () => {
      try {
        const code = await api.chaos.execute(example, { offline: true });
        assert(code === 1, `código ${code}`);
        const results = JSON.parse(require('fs').readFileSync(path.join(example, '.shieldepy', 'chaos-results.json'), 'utf8'));
        const failed = results.outcomes.filter((o) => o.status === 'failed').map((o) => o.failure);
        assert(failed.includes('race_condition') && failed.includes('timeout'), `falhas: ${failed}`);
        assert(require('fs').existsSync(path.join(example, '.shieldepy', 'chaos-report.md')), 'sem o relatório');
      } finally {
        require('fs').rmSync(path.join(example, '.shieldepy'), { recursive: true, force: true });
      }
    });
  } else console.log('  (pulado: R3 com o caos de verdade — rode npm install em examples/checkout-express)');

  const tsconfig = file('checkout/tsconfig.json');
  const tsconfigOriginal = Buffer.from(await vscode.workspace.fs.readFile(tsconfig)).toString('utf8');

  await check('mudar `paths` no tsconfig refaz a resolução sem recarregar a janela', async () => {
    // tira o alias `@/*`: os imports `@/…` do checkout viram imports quebrados
    await vscode.workspace.fs.writeFile(tsconfig, Buffer.from(tsconfigOriginal.split('"@/*"').join('"@nope/*"')));
    await waitFor('imports quebrados aparecerem', () => api.graphStats().importsUnresolved > 0, 15000);
    // devolve o alias: tudo volta a resolver
    await vscode.workspace.fs.writeFile(tsconfig, Buffer.from(tsconfigOriginal));
    await waitFor('imports voltarem', () => api.graphStats().importsUnresolved === 0 && api.graphStats().callsUnresolved === 0, 15000);
    await vscode.commands.executeCommand('shieldepy.showMap');
    assert(edgeIn(api.lastMap(), 'checkout/src/routes/checkout.ts', 'checkout/src/controllers/CheckoutController.ts#CheckoutController.create', 'references'), 'cadeia não voltou');
  });

  await check('workspace acima do teto: a indexação avisa que o mapa ficou parcial', async () => {
    const cfg = vscode.workspace.getConfiguration('shieldepy');
    await cfg.update('index.maxFiles', 10, vscode.ConfigurationTarget.Workspace);
    try {
      const report = await api.reindex();
      assert(report.truncated && report.limit === 10, `relatório: ${JSON.stringify(report)}`);
    } finally {
      await cfg.update('index.maxFiles', undefined, vscode.ConfigurationTarget.Workspace);
    }
    const report = await api.reindex();
    assert(!report.truncated, 'continuou parcial depois de voltar o teto');
  });

  console.log('');
};
