import * as path from 'node:path';
import * as vscode from 'vscode';
import { AGENT_NAME } from '@shieldepy/agent';
import { CodeGraph, isFileOnDisk, readFileOnDisk, toFileId, type Host, type TopologyGraph } from '@shieldepy/core';
import { loadRegistry } from '@shieldepy/extractors';
import { AnalyzingDecorationProvider } from './analysis/AnalyzingDecorationProvider';
import { BackgroundAnalyzer } from './analysis/BackgroundAnalyzer';
import { CollisionPublisher } from './analysis/CollisionPublisher';
import { FindingsCache } from './analysis/FindingsCache';
import { FindingsManager } from './analysis/FindingsManager';
import { ScanAnimator } from './analysis/ScanAnimator';
import { ChaosCommand, type ChaosRunOptions } from './chaos/ChaosCommand';
import { ChatViewProvider, type FindingAttachment } from './chat/ChatViewProvider';
import { explainWorkspaceCollisions, exportTopology, login, logout, refreshAccess, reviewImpact, setApiKey } from './commands';
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
import { indexWorkspace, isAnalyzable, reindexFromDisk, warnIfTruncated, type IndexReport } from './workspace/files';
import { WorkspaceModel } from './workspace/WorkspaceModel';

let model: WorkspaceModel | undefined;

const WALKTHROUGH_SHOWN = 'shieldepy.walkthroughShown';

/** Raiz de composição: cria os serviços, liga eventos e registra views/comandos. Nenhuma regra de negócio aqui. */
/** API exposta só no Extension Host de teste (E2E). */
interface TestApi {
  signInWithToken(token: string): Promise<unknown>;
  /** Por que a empresa desliga a IA agora (null = não desliga). */
  aiBlock(): string | null;
  decorationFor(fsPath: string): { badge?: string; tooltip?: string; color?: string; propagate?: boolean } | undefined;
  /** Estatísticas do grafo em memória (cobertura, imports quebrados). */
  graphStats(): unknown;
  /** Mapa mostrado pela última vez no painel (comando "Ver Mapa do Sistema"). */
  lastMap(): unknown;
  /** Topologia do último "Exportar Topologia" (ou a do painel do mapa). */
  lastTopology(): unknown;
  /** Overlay do último mapa renderizado (caos e diff, V2). */
  lastOverlay(): unknown;
  /** "Comparar mapa com uma branch" sem a caixa de entrada. */
  compareMap(ref: string): Promise<unknown>;
  /** Reindexa o workspace inteiro e devolve o relatório (teto, parcial). */
  reindex(): Promise<IndexReport>;
  /** "Testar Caos" sem as caixas de diálogo (R3). */
  chaos: {
    projects(): unknown;
    missingPackages(root: string): string[];
    createContract(root: string): Promise<boolean>;
    execute(root: string, options: ChaosRunOptions): Promise<number | undefined>;
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<TestApi | undefined> {
  const output = vscode.window.createOutputChannel('ShielDepy');
  const log = (m: string) => output.appendLine(m);
  const host: Host = { log, isFile: isFileOnDisk, readFile: readFileOnDisk };
  const push = (...d: vscode.Disposable[]) => context.subscriptions.push(...d);
  push(output);

  const auth = new AuthService(context.secrets, log);
  push(auth);
  // A conta é opcional (modo local): ela só decide a IA da empresa, nunca o motor. Sem portal
  // configurado, os comandos de conta nem aparecem na paleta.
  await auth.ensureLoaded(context.extension.id);
  const syncPortal = () => vscode.commands.executeCommand('setContext', 'shieldepy.portal', config.hasPortal());
  void syncPortal();
  push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('shieldepy.webBaseUrl')) void syncPortal();
    })
  );

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

  // Gate do motor: só a configuração. A conta não trava a análise local (R1 do plano).
  const isActive = () => config.analysisEnabled();

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

  // A conta mudou (entrou, saiu, empresa suspensa, IA liberada): o motor segue, mas a IA pode ter
  // ligado ou desligado. Reanalisa os abertos para os riscos da IA aparecerem ou sumirem.
  const reanalyzeOpen = () => {
    for (const doc of vscode.workspace.textDocuments) analyzer.runNow(doc);
  };
  push(auth.onDidChangeAuth(() => reanalyzeOpen()));

  // --- views ----------------------------------------------------------------------------
  const chat = new ChatViewProvider(context.extensionUri, ai, workspace, findings, analyzer, auth, log);
  const mapPanel = new MapPanel(context.extensionUri, workspace, path.join(context.extensionPath, 'wasm'));
  push(mapPanel);
  const chaosCommand = new ChaosCommand(context.extensionPath, workspace, ai, log);
  push(chaosCommand);
  let exported: TopologyGraph | undefined;
  push(
    // retainContextWhenHidden: trocar de aba não descarta o rascunho não enviado do chat.
    vscode.window.registerWebviewViewProvider(VIEW_CHAT, chat, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider(VIEW_PANEL, new ShieldepyViewProvider(context.extensionUri, findings, workspace, analyzing, ai, auth)),
    vscode.window.registerWebviewViewProvider(VIEW_SETTINGS, new SettingsViewProvider(context.extensionUri, ai, auth))
  );

  // --- comandos -------------------------------------------------------------------------
  push(
    vscode.commands.registerCommand(CMD.setApiKey, () => setApiKey(ai)),
    vscode.commands.registerCommand(CMD.openDashboard, () => auth.openDashboard()),
    vscode.commands.registerCommand(CMD.refreshAccess, () => refreshAccess(auth)),
    vscode.commands.registerCommand(CMD.openLocation, (file: unknown, line: unknown) => {
      if (typeof file === 'string') return openLocation(file, Number(line));
    }),
    vscode.commands.registerCommand(CMD.scanWorkspace, () => chat.runFullScan()),
    vscode.commands.registerCommand(CMD.showMap, () => mapPanel.show()),
    vscode.commands.registerCommand(CMD.runChaos, () => chaosCommand.run()),
    vscode.commands.registerCommand(CMD.gettingStarted, () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', `${context.extension.id}#start`, false)
    ),
    vscode.commands.registerCommand(CMD.compareMap, async (given?: unknown) => {
      const ref =
        typeof given === 'string'
          ? given
          : await vscode.window.showInputBox({
              title: 'ShielDepy: comparar o mapa com…',
              prompt: 'Branch, tag ou commit. A comparação é com o merge-base, como num PR.',
              value: 'origin/main',
            });
      if (!ref) return;
      try {
        const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `ShielDepy: montando o mapa de ${ref}…` }, () => mapPanel.compare(ref));
        const d = result?.diff;
        if (d) {
          const touched = result.routes?.all ? 'todas as rotas' : `${result.routes?.affected.length ?? 0} rota(s) tocada(s)`;
          void vscode.window.showInformationMessage(
            d.empty
              ? `ShielDepy: nenhuma mudança de estrutura desde ${ref}.`
              : `ShielDepy: desde ${ref}, ${d.symbols.changed.length} alterado(s), ${d.symbols.added.length} novo(s), ${d.symbols.renamed.length} renomeado(s), ${d.symbols.removed.length} removido(s); ${touched}.`
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`ShielDepy: não deu para comparar com ${ref}: ${err instanceof Error ? err.message : err}`);
      }
    }),
    vscode.commands.registerCommand(CMD.exportTopology, async () => {
      exported = (await exportTopology(workspace, () => mapPanel.show())) ?? exported;
    }),
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

  // Primeira vez nesta máquina: abre os primeiros passos (uma vez só; depois, pelo comando ou pelo painel).
  if (context.extensionMode !== vscode.ExtensionMode.Test && !context.globalState.get<boolean>(WALKTHROUGH_SHOWN)) {
    void context.globalState.update(WALKTHROUGH_SHOWN, true);
    void vscode.commands.executeCommand(CMD.gettingStarted);
  }

  // Só no Extension Host de teste: o E2E entra com um token do servidor falso, sem abrir navegador.
  if (context.extensionMode !== vscode.ExtensionMode.Test) return undefined;
  return {
    signInWithToken: (token) => auth.signInWithToken(token),
    aiBlock: () => auth.companyAiBlock(),
    graphStats: () => workspace.graph.stats,
    lastMap: () => mapPanel.last,
    lastTopology: () => exported ?? mapPanel.lastTopology,
    lastOverlay: () => mapPanel.lastOverlay,
    compareMap: (ref) => mapPanel.compare(ref),
    reindex: () => indexWorkspace(workspace, log),
    chaos: {
      projects: () => chaosCommand.projects(),
      missingPackages: (root) => chaosCommand.missingPackages(root),
      createContract: (root) => chaosCommand.createContract(root),
      execute: (root, options) => chaosCommand.execute(root, options),
    },
    decorationFor: (fsPath) => {
      const d = explorer.provideFileDecoration(vscode.Uri.file(fsPath));
      return d && { badge: d.badge, tooltip: d.tooltip, color: d.color?.id, propagate: d.propagate };
    },
  };
}

export function deactivate(): void {
  model?.dispose();
}
