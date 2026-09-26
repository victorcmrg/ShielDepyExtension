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

  await check('a extensão ativa', async () => {
    const ext = vscode.extensions.getExtension('shieldepy.shieldepy');
    assert(ext, 'extensão não encontrada');
    await ext.activate();
    assert(ext.isActive, 'não ativou');
  });

  await check('comandos registrados', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ['shieldepy.explainCollisions', 'shieldepy.scanWorkspace', 'shieldepy.reviewImpact', 'shieldepy.setApiKey']) {
      assert(all.includes(c), `faltando ${c}`);
    }
  });

  const pricing = file('services/pricing/handlers.ts');
  const tax = file('services/tax/handlers.ts');
  const audit = file('services/audit/handlers.ts');
  const shipping = file('services/shipping/handlers.ts');

  await check('colisão write-write em "total" aparece como ERRO em pricing E em tax (sem abrir os arquivos)', async () => {
    for (const uri of [pricing, tax]) {
      const d = await waitFor(`diagnóstico em ${uri.fsPath}`, () =>
        ours(uri, COLISAO).find((x) => x.severity === vscode.DiagnosticSeverity.Error && x.message.includes('write-write'))
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

  await check('shipping (campo exclusivo) NÃO é acusado', async () => {
    assert(ours(shipping, COLISAO).length === 0, 'falso positivo em shipping');
  });

  await check('ciclo a.ts → b.ts → a.ts aparece ao abrir o arquivo', async () => {
    await vscode.window.showTextDocument(file('a.ts'));
    const d = await waitFor('diagnóstico de ciclo', () => ours(file('a.ts'), 'ShielDepy (grafo)').find((x) => x.message.includes('Ciclo')));
    assert(d.severity === vscode.DiagnosticSeverity.Warning, 'ciclo deveria ser aviso');
  });

  await check('editar tax pra escrever outro campo DESFAZ a colisão nos dois arquivos (ao vivo)', async () => {
    const doc = await vscode.workspace.openTextDocument(tax);
    await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const edit = new vscode.WorkspaceEdit();
    edit.replace(tax, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), text.replace('order.total =', 'order.taxTotal ='));
    assert(await vscode.workspace.applyEdit(edit), 'edição não aplicada');
    await waitFor('colisão sumir de pricing', () => !ours(pricing, COLISAO).some((x) => x.message.includes('write-write')), 15000);
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

  console.log('');
};
