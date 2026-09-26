import * as vscode from 'vscode';
import { config } from '../config';
import { CMD } from '../constants';
import type { AnalyzingDecorationProvider } from '../analysis/AnalyzingDecorationProvider';
import type { FindingsManager } from '../analysis/FindingsManager';
import type { AiService } from '../services/AiService';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import { renderWebview } from './webview';

/**
 * Painel principal: switch das sugestões inline, indicador "Analisando", resumo do workspace
 * (IA ativa, regras, colisões) e os achados agrupados por arquivo. "Ask AI" vai por COMANDO
 * (item 5.2) — o painel não conhece o chat.
 */
export class ShieldepyViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly findings: FindingsManager,
    private readonly model: WorkspaceModel,
    private readonly analyzing: AnalyzingDecorationProvider,
    private readonly ai: AiService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'panel',
      initial: { inlineEnabled: config.inlineEnabled(), graphReady: this.model.graph.isReady },
      body: `
  <div class="protect-row">
    <label class="switch"><input type="checkbox" id="toggle" /><span class="slider"></span></label>
    <span class="protect-label" id="status"></span>
  </div>
  <div class="analyzing-row" id="analyzingRow"><span class="morph-shape"></span><span id="analyzingText"></span></div>
  <div class="notice" id="graphNotice" hidden>Grafo estrutural indisponível — as gramáticas .wasm do Tree-sitter não carregaram. Colisões de Java/Python/C# seguem funcionando.</div>
  <div class="summary" id="summary"></div>
  <h4>Problemas encontrados</h4>
  <div id="findings"><div class="empty">Nenhum problema encontrado ainda.</div></div>`,
    });

    const disposables = [
      webviewView.webview.onDidReceiveMessage(async (message) => {
        switch (message?.type) {
          case 'ready':
            this.refreshAll();
            break;
          case 'toggle':
            await config.update('inlineSuggestions.enabled', Boolean(message.value));
            break;
          case 'reveal':
            await revealLine(String(message.fileId), Number(message.line));
            break;
          case 'askAI':
            await vscode.commands.executeCommand(CMD.attachFinding, message.finding);
            break;
          case 'explainCollisions':
            await vscode.commands.executeCommand(CMD.explainCollisions);
            break;
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('shieldepy')) this.refreshAll();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshAnalyzing()),
      this.findings.onDidChange(() => this.refreshFindings()),
      this.analyzing.onDidChangeAnalyzing(() => this.refreshAnalyzing()),
      this.ai.onDidChange(() => void this.refreshSummary()),
    ];
    webviewView.onDidDispose(() => {
      for (const d of disposables) d.dispose();
      this.view = undefined;
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private refreshAll(): void {
    this.post({ type: 'syncToggle', value: config.inlineEnabled() });
    this.refreshFindings();
    this.refreshAnalyzing();
    void this.refreshSummary();
  }

  private async refreshSummary(): Promise<void> {
    this.post({
      type: 'summary',
      engine: await this.ai.engine(),
      rules: this.model.rules.length,
      collisions: this.model.collisions().length,
    });
  }

  private refreshAnalyzing(): void {
    const editor = vscode.window.activeTextEditor;
    this.post({
      type: 'analyzing',
      active: Boolean(editor && this.analyzing.isAnalyzing(editor.document.uri)),
      fileName: editor?.document.uri.path.split('/').pop() ?? null,
    });
  }

  /** Uma "gaveta" por arquivo, mais problemática primeiro. Sistema desligado = lista vazia. */
  private refreshFindings(): void {
    void this.refreshSummary();
    if (!config.analysisEnabled()) {
      this.post({ type: 'findingsByFile', groups: [], systemDisabled: true });
      return;
    }
    const groups = this.findings
      .getAllByFile()
      .map(({ fileId, findings }) => {
        const fileName = vscode.workspace.asRelativePath(vscode.Uri.file(fileId));
        return {
          fileId,
          fileName,
          items: findings
            .map((f) => ({
              id: f.id,
              fileId,
              fileName,
              line: f.startLine,
              severity: f.severity,
              message: f.message,
              impact: f.impact ?? '',
              source: f.source,
            }))
            .sort((a, b) => a.line - b.line),
        };
      })
      .sort((a, b) => b.items.length - a.items.length);
    this.post({ type: 'findingsByFile', groups, systemDisabled: false });
  }
}

async function revealLine(fileId: string, line: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(fileId), { preserveFocus: false });
  const position = new vscode.Position(Math.max(line, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
