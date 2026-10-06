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
    for (const c of ['shieldepy.explainCollisions', 'shieldepy.scanWorkspace', 'shieldepy.reviewImpact', 'shieldepy.setApiKey', 'shieldepy.refreshAccess', 'shieldepy.openDashboard']) {
      assert(all.includes(c), `faltando ${c}`);
    }
  });

  const pricing = file('services/pricing/handlers.ts');
  const tax = file('services/tax/handlers.ts');
  const audit = file('services/audit/handlers.ts');
  const shipping = file('services/shipping/handlers.ts');
  const setCompanyAccess = (enabled) =>
    fetch(`${process.env.SHIELDEPY_E2E_ACCOUNT_URL}/__e2e/access`, { method: 'POST', body: JSON.stringify({ enabled }) });

  await check('sem login, nada é analisado (colisões ficam de fora)', async () => {
    await sleep(4000); // tempo de sobra pra indexação inicial terminar
    assert(ours(pricing).length === 0 && ours(tax).length === 0, 'achados publicados sem login');
  });

  await check('login com acesso liberado ativa a extensão', async () => {
    const state = await api.signInWithToken(process.env.SHIELDEPY_E2E_TOKEN);
    assert(state === 'active', `estado inesperado: ${state}`);
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
  await check('empresa suspensa: rechecar acesso limpa todos os achados', async () => {
    assert(ours(file('a.ts')).length > 0, 'pré-condição: ciclo ainda deveria estar publicado');
    auditBefore = ours(audit, COLISAO).length;
    assert(auditBefore > 0, 'pré-condição: audit deveria ter colisões');
    await setCompanyAccess(false);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('achados sumirem', () => ours(file('a.ts')).length === 0 && ours(audit).length === 0, 10000);
  });

  await check('suspenso: editar um arquivo não gera análise nova', async () => {
    const doc = await vscode.workspace.openTextDocument(file('b.ts'));
    await vscode.window.showTextDocument(doc);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, new vscode.Position(doc.lineCount, 0), '// edição durante a suspensão\n');
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    await sleep(3000);
    assert(ours(file('b.ts')).length === 0 && ours(file('a.ts')).length === 0, 'analisou com a empresa suspensa');
  });

  await check('acesso liberado de novo: achados voltam sozinhos', async () => {
    await setCompanyAccess(true);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('ciclo voltar', () => ours(file('a.ts'), 'ShielDepy (grafo)').some((x) => x.message.includes('Ciclo')), 15000);
    await waitFor('colisões de audit voltarem', () => ours(audit, COLISAO).length === auditBefore, 15000);
  });

  const setRepoAllowed = (allowed) =>
    fetch(`${process.env.SHIELDEPY_E2E_ACCOUNT_URL}/__e2e/repo`, { method: 'POST', body: JSON.stringify({ allowed }) });

  await check('repositório tirado do projeto: a extensão trava e limpa os achados', async () => {
    await setRepoAllowed(false);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('achados sumirem', () => ours(file('a.ts')).length === 0 && ours(audit).length === 0, 10000);
  });

  await check('repositório conectado de novo: volta sozinho', async () => {
    await setRepoAllowed(true);
    await vscode.commands.executeCommand('shieldepy.refreshAccess');
    await waitFor('ciclo voltar', () => ours(file('a.ts'), 'ShielDepy (grafo)').some((x) => x.message.includes('Ciclo')), 15000);
  });

  console.log('');
};
