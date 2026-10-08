import * as path from 'node:path';
import * as vscode from 'vscode';
import { AGENT_NAME } from '@shieldepy/agent';
import { CodeGraph, isFileOnDisk, readFileOnDisk, toFileId, type Host } from '@shieldepy/core';
import { loadRegistry } from '@shieldepy/extractors';
import { AnalyzingDecorationProvider } from './analysis/AnalyzingDecorationProvider';
import { BackgroundAnalyzer } from './analysis/BackgroundAnalyzer';
import { CollisionPublisher } from './analysis/CollisionPublisher';
import { FindingsCache } from './analysis/FindingsCache';
import { FindingsManager } from './analysis/FindingsManager';
import { ScanAnimator } from './analysis/ScanAnimator';
import { ChatViewProvider, type FindingAttachment } from './chat/ChatViewProvider';
import { explainWorkspaceCollisions, login, logout, refreshAccess, requireAccess, reviewImpact, setApiKey } from './commands';
import { config } from './config';
import { CMD, FILE_GLOB, INLINE_LANGUAGES, MODULE_CONFIG_GLOB, VIEW_CHAT, VIEW_PANEL, VIEW_SETTINGS } from './constants';
import { InlineSuggestionProvider } from './inline/InlineSuggestionProvider';
import { AiService } from './services/AiService';
import { AuthService } from './services/AuthService';
import { SettingsViewProvider } from './views/SettingsViewProvider';
import { ShieldepyViewProvider } from './views/ShieldepyViewProvider';
import { StatusBar } from './views/StatusBar';
import { ConflictBalloon, openLocation } from './views/ConflictBalloon';
import { ExplorerDecorations } from './views/ExplorerDecorations';
import { MapPanel } from './views/MapPanel';
import { indexWorkspace, isAnalyzable, reindexFromDisk, setPathGate, warnIfTruncated, type IndexReport } from './workspace/files';
import { WorkspaceModel } from './workspace/WorkspaceModel';

let model: WorkspaceModel | undefined;

/** Raiz de composição: cria os serviços, liga eventos e registra views/comandos. Nenhuma regra de negócio aqui. */
/** API exposta só no Extension Host de teste (E2E). */
interface TestApi {
  signInWithToken(token: string): Promise<unknown>;
  decorationFor(fsPath: string): { badge?: string; tooltip?: string; color?: string; propagate?: boolean } | undefined;
  /** Estatísticas do grafo em memória (cobertura, imports quebrados). */
  graphStats(): unknown;
  /** Mapa mostrado pela última vez no painel (comando "Ver Mapa do Sistema"). */
  lastMap(): unknown;
  /** Reindexa o workspace inteiro e devolve o relatório (teto, parcial). */
  reindex(): Promise<IndexReport>;
}

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const output = vscode.window.createOutputChannel('ShielDepy');
  const log = (m: string) => output.appendLine(m);
  const host: Host = { log, isFile: isFileOnDisk, readFile: readFileOnDisk };
  const push = (...d: vscode.Disposable[]) => context.subscriptions.push(...d);
  push(output);

  const auth = new AuthService(context.secrets, log);
  push(auth);
  await auth.ensureLoaded(context.extension.id);
  // Só repositórios dos projetos da pessoa são analisados (o servidor decide pelo remote do .git).
  setPathGate((fsPath) => auth.isAllowedPath(fsPath));
  // Sem acesso, o Chat some da barra lateral: a tela de bloqueio aparece uma vez só, no painel.
  const syncUnlocked = () => vscode.commands.executeCommand('setContext', 'shieldepy.unlocked', auth.canUse());
  void syncUnlocked();
  push(auth.onDidChangeAuth(() => void syncUnlocked()));

  // vscode://<publisher>.<name>/callback — recebe o retorno do navegador depois de
  // "Confiar" no /device-confirm (ver AuthService.completeLogin). A authority vem
  // de context.extension.id, não hardcoded.
  push(
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path !== '/callback') return;
        const query = new URLSearchParams(uri.query);
        const code = query.get('code');
        const state = query.get('state');
        if (!code || !state) {
          log('[extension] callback de login recebido sem code/state — ignorado.');
          return;
        }
        void auth.completeLogin(code, state);
      },
    }),
    vscode.commands.registerCommand(CMD.login, () => login(auth)),
    vscode.commands.registerCommand(CMD.logout, () => logout(auth))
  );

  // Grafo estrutural. Sem as gramáticas .wasm, segue sem o grafo (as regras ainda funcionam) — a
  // extensão nunca deixa de ativar por causa disso.
  let graph: CodeGraph;
  try {
    graph = await CodeGraph.create(path.join(context.extensionPath, 'wasm'), host);
  } catch (err) {
    log(`[ShielDepy] falha ao carregar o Tree-sitter: ${err}`);
    void vscode.window.showWarningMessage('ShielDepy: gramáticas do Tree-sitter indisponíveis — grafo de TS/JS desativado (colisões seguem funcionando).');
    graph = new CodeGraph(undefined, host);
  }
  // Extratores de regras (Java/Python/C# + TS). Gramática que não carregar só tira a sua linguagem.
  const registry = await loadRegistry(path.join(context.extensionPath, 'wasm'), { tsParser: graph.tsParser });
  if (registry.failed.length > 0) log(`[ShielDepy] gramáticas indisponíveis: ${registry.failed.join(', ')}`);
  model = new WorkspaceModel(graph, registry, (p) => vscode.workspace.asRelativePath(p));
  const workspace = model;

  const cache = new FindingsCache(context.globalStorageUri.fsPath, log);
  await cache.load();
  push({ dispose: () => void cache.dispose() });

  // Gate único: sistema ligado nas settings E conta com acesso liberado pela empresa.
  const isActive = () => config.analysisEnabled() && auth.canUse();

  const findings = new FindingsManager(cache, context.extensionUri);
  const ai = new AiService(context.secrets, log, auth);
  const analyzing = new AnalyzingDecorationProvider();
  const animator = new ScanAnimator();
  const analyzer = new BackgroundAnalyzer(workspace, ai, findings, analyzing, animator, log, isActive);
  const collisions = new CollisionPublisher(workspace, findings, isActive);
  const statusBar = new StatusBar(auth, findings, analyzing);
  const balloon = new ConflictBalloon(findings);
  const explorer = new ExplorerDecorations(findings, analyzing);
  void context.workspaceState.update('shieldepy.pins', undefined); // resto do antigo "tirar da lista"
  push(findings, ai, analyzing, animator, analyzer, collisions, statusBar, balloon, explorer, vscode.window.registerFileDecorationProvider(explorer));

  // Acesso caiu (logout, token revogado, empresa suspensa): para tudo e limpa o que estava na tela.
  // Voltou: republica as colisões e reanalisa os arquivos abertos.
  const reanalyzeOpen = () => {
    for (const doc of vscode.workspace.textDocuments) analyzer.runNow(doc);
  };
  push(
    auth.onDidChangeAuth((state) => {
      if (state === 'active') {
        collisions.publish();
        reanalyzeOpen();
      } else {
        analyzer.cancelAll();
        findings.clearAll();
      }
    })
  );

  // --- views ----------------------------------------------------------------------------
  const chat = new ChatViewProvider(context.extensionUri, ai, workspace, findings, analyzer, auth, log);
  const mapPanel = new MapPanel(context.extensionUri, workspace);
  push(mapPanel);
  push(
    // retainContextWhenHidden: trocar de aba não descarta o rascunho não enviado do chat.
    vscode.window.registerWebviewViewProvider(VIEW_CHAT, chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(VIEW_PANEL, new ShieldepyViewProvider(context.extensionUri, findings, workspace, analyzing, ai, auth)),
    vscode.window.registerWebviewViewProvider(VIEW_SETTINGS, new SettingsViewProvider(context.extensionUri, ai, auth))
  );

  // --- comandos -------------------------------------------------------------------------
  /** Comando que usa o workspace/IA: só roda com acesso confirmado no servidor. */
  const guarded = <A extends unknown[]>(fn: (...args: A) => unknown) =>
    async (...args: A) => {
      if (await requireAccess(auth)) await fn(...args);
    };
  push(
    vscode.commands.registerCommand(CMD.setApiKey, () => setApiKey(ai)),
    vscode.commands.registerCommand(CMD.openDashboard, () => auth.openDashboard()),
    vscode.commands.registerCommand(CMD.refreshAccess, () => refreshAccess(auth)),
    vscode.commands.registerCommand(CMD.openLocation, (file: unknown, line: unknown) => {
      if (typeof file === 'string') return openLocation(file, Number(line));
    }),
    vscode.commands.registerCommand(CMD.scanWorkspace, guarded(() => chat.runFullScan())),
    vscode.commands.registerCommand(CMD.showMap, guarded(() => mapPanel.show())),
    vscode.commands.registerCommand(CMD.attachFinding, guarded((finding: FindingAttachment) => chat.attachFinding(finding))),
    vscode.commands.registerCommand(CMD.toggleInline, async () => {
      const next = !config.inlineEnabled();
      await config.update('inlineSuggestions.enabled', next);
      vscode.window.setStatusBarMessage(`ShielDepy: sugestões inline ${next ? 'ativadas' : 'desativadas'}`, 3000);
    }),
    vscode.commands.registerCommand(CMD.reviewImpact, guarded(() => reviewImpact(workspace, ai))),
    vscode.commands.registerCommand(CMD.explainCollisions, guarded(() => explainWorkspaceCollisions(workspace, ai, log))),
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
      if (e.affectsConfiguration('shieldepy.backgroundAnalysis.enabled')) {
        collisions.schedule(0);
        if (config.analysisEnabled()) reanalyzeOpen();
        else analyzer.cancelAll();
      }
      // Severidade mínima ou idioma: republica tudo (o filtro vale pra trás; o hover sai no idioma novo).
      if (e.affectsConfiguration('shieldepy.display.minSeverity') || e.affectsConfiguration('shieldepy.language')) findings.refreshAll();
      if (e.affectsConfiguration('shieldepy.analysis.exclude')) {
        // Recém-excluído: some da tela. Recém-incluído: analisa agora.
        for (const doc of vscode.workspace.textDocuments) {
          if (doc.uri.scheme !== 'file') continue;
          if (isAnalyzable(doc)) analyzer.runNow(doc);
          else findings.clear(toFileId(doc.uri.fsPath), 'analysis');
        }
      }
    })
  );

  // Mudanças fora do editor (git checkout, gerador de código): arquivo aberto é tratado pelos
  // eventos acima; o resto é relido do disco pra o grafo e as colisões não ficarem velhos.
  // tsconfig/jsconfig mudou (ex: `paths`): o grafo refaz a resolução de imports e chamadas.
  // Debounce: um `git checkout` mexe em vários de uma vez.
  let configTimer: ReturnType<typeof setTimeout> | undefined;
  const onModuleConfig = (uri: vscode.Uri) => {
    clearTimeout(configTimer);
    configTimer = setTimeout(() => {
      log(`[index] configuração de módulos mudou (${vscode.workspace.asRelativePath(uri)}): refazendo a resolução de imports.`);
      workspace.graph.reloadModuleConfig();
    }, 300);
  };
  const configWatcher = vscode.workspace.createFileSystemWatcher(MODULE_CONFIG_GLOB);
  push(configWatcher, configWatcher.onDidCreate(onModuleConfig), configWatcher.onDidChange(onModuleConfig), configWatcher.onDidDelete(onModuleConfig), {
    dispose: () => clearTimeout(configTimer),
  });

  const watcher = vscode.workspace.createFileSystemWatcher(FILE_GLOB);
  const onDisk = (uri: vscode.Uri) => {
    if (!vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString())) void reindexFromDisk(workspace, uri);
  };
  push(watcher, watcher.onDidCreate(onDisk), watcher.onDidChange(onDisk));

  indexWorkspace(workspace, log)
    .then((report) => {
      void warnIfTruncated(report);
      collisions.publish();
      for (const doc of vscode.workspace.textDocuments) analyzer.runNow(doc);
    })
    .catch((err) => log(`[ShielDepy] indexação inicial falhou: ${err}`));

  log(`ShielDepy ativo — grafo ${graph.isReady ? 'com' : 'SEM'} Tree-sitter, agente ${AGENT_NAME}.`);

  // Só no Extension Host de teste: o E2E entra com um token do servidor falso, sem abrir navegador.
  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
    signInWithToken: (token) => auth.signInWithToken(token),
    graphStats: () => workspace.graph.stats,
    lastMap: () => mapPanel.last,
    reindex: () => indexWorkspace(workspace, log),
    decorationFor: (fsPath) => {
      const d = explorer.provideFileDecoration(vscode.Uri.file(fsPath));
      return d && { badge: d.badge, tooltip: d.tooltip, color: d.color?.id, propagate: d.propagate };
    },
  };
}

export function deactivate(): void {
  model?.dispose();
}
