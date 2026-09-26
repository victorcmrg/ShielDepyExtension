import * as path from 'node:path';
import * as vscode from 'vscode';
import { AGENT_NAME } from '@shieldepy/agent';
import { CodeGraph, isFileOnDisk, type Host } from '@shieldepy/core';
import { createRegistry } from '@shieldepy/extractors';
import { AnalyzingDecorationProvider } from './analysis/AnalyzingDecorationProvider';
import { BackgroundAnalyzer } from './analysis/BackgroundAnalyzer';
import { CollisionPublisher } from './analysis/CollisionPublisher';
import { FindingsCache } from './analysis/FindingsCache';
import { FindingsManager } from './analysis/FindingsManager';
import { ScanAnimator } from './analysis/ScanAnimator';
import { ChatViewProvider, type FindingAttachment } from './chat/ChatViewProvider';
import { explainWorkspaceCollisions, reviewImpact, setApiKey } from './commands';
import { config } from './config';
import { CMD, FILE_GLOB, INLINE_LANGUAGES, VIEW_CHAT, VIEW_PANEL, VIEW_SETTINGS } from './constants';
import { InlineSuggestionProvider } from './inline/InlineSuggestionProvider';
import { AiService } from './services/AiService';
import { SettingsViewProvider } from './views/SettingsViewProvider';
import { ShieldepyViewProvider } from './views/ShieldepyViewProvider';
import { indexWorkspace, isAnalyzable, reindexFromDisk } from './workspace/files';
import { WorkspaceModel } from './workspace/WorkspaceModel';

let model: WorkspaceModel | undefined;

/** Raiz de composição: cria os serviços, liga eventos e registra views/comandos. Nenhuma regra de negócio aqui. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('ShielDepy');
  const log = (m: string) => output.appendLine(m);
  const host: Host = { log, isFile: isFileOnDisk };
  const push = (...d: vscode.Disposable[]) => context.subscriptions.push(...d);
  push(output);

  // Grafo estrutural. Sem as gramáticas .wasm, segue com HTML/CSS e regras via regex — a
  // extensão nunca deixa de ativar por causa disso.
  let graph: CodeGraph;
  try {
    graph = await CodeGraph.create(path.join(context.extensionPath, 'wasm'), host);
  } catch (err) {
    log(`[ShielDepy] falha ao carregar o Tree-sitter: ${err}`);
    void vscode.window.showWarningMessage('ShielDepy: gramáticas do Tree-sitter indisponíveis — grafo de TS/JS desativado (colisões seguem funcionando).');
    graph = new CodeGraph(undefined, host);
  }
  model = new WorkspaceModel(graph, createRegistry(), (p) => vscode.workspace.asRelativePath(p));
  const workspace = model;

  const cache = new FindingsCache(context.globalStorageUri.fsPath, log);
  await cache.load();
  push({ dispose: () => void cache.dispose() });

  const findings = new FindingsManager(cache);
  const ai = new AiService(context.secrets, log);
  const analyzing = new AnalyzingDecorationProvider();
  const animator = new ScanAnimator();
  const analyzer = new BackgroundAnalyzer(workspace, ai, findings, analyzing, animator, log);
  const collisions = new CollisionPublisher(workspace, findings, () => config.analysisEnabled());
  push(findings, ai, analyzing, animator, analyzer, collisions, vscode.window.registerFileDecorationProvider(analyzing));

  // --- views ----------------------------------------------------------------------------
  const chat = new ChatViewProvider(context.extensionUri, ai, workspace, findings, analyzer, log);
  push(
    // retainContextWhenHidden: trocar de aba não descarta o rascunho não enviado do chat.
    vscode.window.registerWebviewViewProvider(VIEW_CHAT, chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(VIEW_PANEL, new ShieldepyViewProvider(context.extensionUri, findings, workspace, analyzing, ai)),
    vscode.window.registerWebviewViewProvider(VIEW_SETTINGS, new SettingsViewProvider(context.extensionUri, ai))
  );

  // --- comandos -------------------------------------------------------------------------
  push(
    vscode.commands.registerCommand(CMD.setApiKey, () => setApiKey(ai)),
    vscode.commands.registerCommand(CMD.scanWorkspace, () => chat.runFullScan()),
    vscode.commands.registerCommand(CMD.attachFinding, (finding: FindingAttachment) => chat.attachFinding(finding)),
    vscode.commands.registerCommand(CMD.toggleInline, async () => {
      const next = !config.inlineEnabled();
      await config.update('inlineSuggestions.enabled', next);
      vscode.window.setStatusBarMessage(`ShielDepy: sugestões inline ${next ? 'ativadas' : 'desativadas'}`, 3000);
    }),
    vscode.commands.registerCommand(CMD.reviewImpact, () => reviewImpact(workspace, ai)),
    vscode.commands.registerCommand(CMD.explainCollisions, () => explainWorkspaceCollisions(workspace, ai, log)),
    vscode.languages.registerInlineCompletionItemProvider(
      INLINE_LANGUAGES.map((language) => ({ language, scheme: 'file' })),
      new InlineSuggestionProvider(workspace, ai, log)
    )
  );

  // --- eventos de documento --------------------------------------------------------------
  // A análise reindexa o arquivo ela mesma — os eventos só dizem QUANDO (item 2.4).
  push(
    vscode.workspace.onDidSaveTextDocument((doc) => analyzer.runNow(doc)),
    vscode.workspace.onDidOpenTextDocument((doc) => analyzer.runNow(doc)),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (!isAnalyzable(document)) return;
      workspace.scheduleUpdate(document.uri.fsPath, () => document.getText(), 800);
      analyzer.schedule(document);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => analyzer.cancel(doc.uri)),
    vscode.workspace.onDidDeleteFiles((e) => {
      for (const uri of e.files) {
        workspace.removeFile(uri.fsPath);
        analyzer.forget(uri);
      }
    }),
    vscode.workspace.onDidRenameFiles((e) => {
      for (const { oldUri, newUri } of e.files) {
        workspace.removeFile(oldUri.fsPath);
        analyzer.forget(oldUri);
        void reindexFromDisk(workspace, newUri);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('shieldepy.backgroundAnalysis.enabled')) collisions.schedule(0);
    })
  );

  // Mudanças fora do editor (git checkout, gerador de código): arquivo aberto é tratado pelos
  // eventos acima; o resto é relido do disco pra o grafo e as colisões não ficarem velhos.
  const watcher = vscode.workspace.createFileSystemWatcher(FILE_GLOB);
  const onDisk = (uri: vscode.Uri) => {
    if (!vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString())) void reindexFromDisk(workspace, uri);
  };
  push(watcher, watcher.onDidCreate(onDisk), watcher.onDidChange(onDisk));

  indexWorkspace(workspace, log)
    .then(() => {
      collisions.publish();
      for (const doc of vscode.workspace.textDocuments) analyzer.runNow(doc);
    })
    .catch((err) => log(`[ShielDepy] indexação inicial falhou: ${err}`));

  log(`ShielDepy ativo — grafo ${graph.isReady ? 'com' : 'SEM'} Tree-sitter, agente ${AGENT_NAME}.`);
}

export function deactivate(): void {
  model?.dispose();
}
