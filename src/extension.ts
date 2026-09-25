import * as vscode from 'vscode';
import { GraphManager } from './graph/GraphManager';
import { AnthropicService, API_KEY_SECRET_KEY } from './services/AnthropicService';
import { InlineSuggestionProvider } from './inline/InlineSuggestionProvider';
import { ShieldepyViewProvider } from './views/ShieldepyViewProvider';
import { BackgroundAnalyzer } from './analysis/BackgroundAnalyzer';
import { FindingsManager } from './analysis/FindingsManager';
import { FindingsCache } from './analysis/FindingsCache';
import { AnalyzingDecorationProvider } from './analysis/AnalyzingDecorationProvider';
import { ScanAnimator } from './analysis/ScanAnimator';
import { ChatViewProvider } from './chat/ChatViewProvider';
import { SettingsViewProvider } from './views/SettingsViewProvider';

const SUPPORTED_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'html', 'css'];

let graphManager: GraphManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('ShielDepy');
  context.subscriptions.push(output);

  graphManager = new GraphManager(output);

  // Cache permanente e invisível dos achados — fica na storage da própria extensão, nunca
  // dentro do projeto do usuário. Cada achado ganha um ID estável (#abc1234) referenciável
  // depois no chat, e sobrevive a reinícios do VS Code.
  const findingsCache = new FindingsCache(context.globalStorageUri.fsPath, output);
  await findingsCache.load();
  context.subscriptions.push({ dispose: () => findingsCache.dispose() });

  const findingsManager = new FindingsManager(findingsCache);
  context.subscriptions.push({ dispose: () => findingsManager.dispose() });

  const anthropicService = new AnthropicService(output, context.secrets);

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === API_KEY_SECRET_KEY) anthropicService.invalidateClient();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('shieldepy.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'ShielDepy: Configurar Chave da API da Anthropic',
        prompt: 'Cole sua chave (sk-ant-...). Fica salva de forma segura e criptografada (Secret Storage do VS Code), disponível em qualquer projeto que você abrir — não só neste.',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key?.trim()) return;

      await context.secrets.store(API_KEY_SECRET_KEY, key.trim());
      void vscode.window.showInformationMessage('ShielDepy: chave da API salva com segurança.');
    })
  );

  // Badge no Explorer (verde do projeto) enquanto um arquivo está sendo analisado — ver o
  // comentário em AnalyzingDecorationProvider sobre o limite real da API pra "ícone animado".
  const analyzingDecorations = new AnalyzingDecorationProvider();
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(analyzingDecorations));
  context.subscriptions.push(analyzingDecorations);

  // Overlay verde leve que anda pela árvore real (Tree-sitter) da região sendo analisada,
  // enquanto espera a resposta do Haiku — ver ScanAnimator.
  const scanAnimator = new ScanAnimator();
  context.subscriptions.push(scanAnimator);

  // Análise automática de arquitetura: roda em toda edição (digitação, colar, ou mudança
  // programática — onDidChangeTextDocument dispara igual nos três casos), depois de um
  // idle debounced, e imediatamente ao salvar. Publica achados como Diagnostics + marca-texto
  // colorido + lista na sidebar (via FindingsManager), sem exigir nenhum comando manual.
  const backgroundAnalyzer = new BackgroundAnalyzer(graphManager, anthropicService, findingsManager, analyzingDecorations, scanAnimator, output);
  context.subscriptions.push({ dispose: () => backgroundAnalyzer.dispose() });

  const chatViewProvider = new ChatViewProvider(anthropicService, graphManager, findingsManager, backgroundAnalyzer, output);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      // Mantém o DOM do chat vivo enquanto a view fica escondida (trocar de aba, minimizar a
      // sidebar) — sem isso o VS Code descarta o webview e o rascunho não enviado se perde.
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Registra as views ANTES de inicializar o Tree-sitter: se os .wasm estiverem faltando e a
  // inicialização falhar, a sidebar ainda resolve normalmente (mostrando o aviso de grafo
  // indisponível) em vez de ficar girando pra sempre esperando um provider que nunca chegou a existir.
  const viewProvider = new ShieldepyViewProvider(context.extensionUri, findingsManager, graphManager, chatViewProvider, analyzingDecorations);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ShieldepyViewProvider.viewType, viewProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('shieldepy.scanWorkspace', () => chatViewProvider.runFullScan())
  );

  const settingsViewProvider = new SettingsViewProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SettingsViewProvider.viewType, settingsViewProvider)
  );

  try {
    await graphManager.initialize(context);
    // Fire-and-forget de propósito (não bloqueia a ativação), mas SEM .catch() uma falha
    // aqui vira uma promise rejeitada sem tratamento — o try/catch ao redor não protege
    // isso, porque não tem await: por quando ela rejeitar, o catch já passou. É o mesmo
    // tipo de bug que o BackgroundAnalyzer existe pra pegar, só que no nosso código.
    graphManager.indexWorkspace().catch((err) => {
      output.appendLine(`[GraphManager] indexação inicial do workspace falhou: ${err}`);
    });
  } catch (err) {
    output.appendLine(`[ShielDepy] falha ao inicializar o Tree-sitter: ${err}`);
    void vscode.window.showErrorMessage(
      'ShielDepy: não consegui carregar as gramáticas do Tree-sitter. Verifique se os arquivos .wasm estão em "wasm/" (veja o README). A extensão segue ativa, mas sem análise de grafo até isso ser corrigido.'
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isSupported(doc) || !graphManager) return;
      await graphManager.updateFile(doc.uri, doc.getText());
      backgroundAnalyzer.runNow(doc);
    })
  );

  // Também analisa ao simplesmente ABRIR um arquivo já existente (não só ao editar/salvar) —
  // cobre o caso de abrir um arquivo com um bug que já estava lá, sem precisar tocar nele.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!isSupported(doc) || !graphManager) return;
      await graphManager.updateFile(doc.uri, doc.getText());
      backgroundAnalyzer.runNow(doc);
    })
  );

  // Mantém o grafo razoavelmente atualizado durante a digitação (reparse incremental, debounced).
  const debouncedChange = debounce((doc: vscode.TextDocument) => {
    if (!isSupported(doc) || !graphManager) return;
    void graphManager.updateFile(doc.uri, doc.getText());
  }, 800);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!isSupported(e.document)) return;
      debouncedChange(e.document);
      backgroundAnalyzer.schedule(e.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => backgroundAnalyzer.clear(doc.uri))
  );

  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles((e) => {
      for (const uri of e.files) {
        graphManager?.removeFile(uri);
        backgroundAnalyzer.clear(uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('shieldepy.reviewImpact', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !graphManager) return;

      const doc = editor.document;
      const subgraph = graphManager.getImpactSubgraph(doc.uri.toString(), 2);

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'ShielDepy: analisando subgrafo de impacto…' },
        async () => {
          const result = await anthropicService.reviewChange(doc.getText(), doc.uri.fsPath, subgraph);
          await showReviewResult(result);
        }
      );
    })
  );

  const inlineProvider = new InlineSuggestionProvider(graphManager, anthropicService);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('shieldepy.toggleInlineSuggestions', async () => {
      const cfg = vscode.workspace.getConfiguration('shieldepy');
      const current = cfg.get<boolean>('inlineSuggestions.enabled', true);
      await cfg.update('inlineSuggestions.enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(
        `ShielDepy: sugestões inline ${!current ? 'ativadas' : 'desativadas'}`,
        3000
      );
    })
  );

  output.appendLine('ShielDepy ativo — grafo de arquitetura em memória inicializado.');
}

export function deactivate(): void {
  graphManager?.dispose();
}

function isSupported(doc: vscode.TextDocument): boolean {
  return SUPPORTED_LANGUAGES.includes(doc.languageId);
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

async function showReviewResult(markdown: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}
