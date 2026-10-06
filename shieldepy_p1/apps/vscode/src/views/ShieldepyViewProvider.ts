import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { FindingSeverity } from '@shieldepy/core';
import { config } from '../config';
import { CMD } from '../constants';
import type { AnalyzingDecorationProvider } from '../analysis/AnalyzingDecorationProvider';
import type { FindingsManager } from '../analysis/FindingsManager';
import type { AiService } from '../services/AiService';
import type { AuthService } from '../services/AuthService';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';
import { readSnippet } from '../analysis/conflictSnippet';
import { strings, t } from '../i18n';
import { escapeHtml, renderWebview } from './webview';

/**
 * Painel principal: estado da proteção, indicador "Analisando", contagem por severidade (que
 * também filtra) e os achados agrupados por arquivo, cada um com um balão de detalhes. "Perguntar"
 * vai por COMANDO (item 5.2) — o painel não conhece o chat. O switch das sugestões inline mora
 * nas configurações.
 */
export class ShieldepyViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly findings: FindingsManager,
    private readonly model: WorkspaceModel,
    private readonly analyzing: AnalyzingDecorationProvider,
    private readonly ai: AiService,
    private readonly auth: AuthService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    this.render(webviewView);

    const disposables = [
      webviewView.webview.onDidReceiveMessage(async (message) => {
        switch (message?.type) {
          case 'ready':
            this.refreshAll();
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
          case 'login':
            await vscode.commands.executeCommand(CMD.login);
            break;
          case 'refreshAccess':
            await vscode.commands.executeCommand(CMD.refreshAccess);
            break;
          case 'openDashboard':
            await vscode.commands.executeCommand(CMD.openDashboard);
            break;
          case 'openSettings':
            await vscode.commands.executeCommand(CMD.focusSettings);
            break;
          case 'openRelated':
            await vscode.commands.executeCommand(CMD.openLocation, String(message.file), Number(message.line));
            break;
        }
      }),
      this.auth.onDidChangeAuth(() => this.refreshAll()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // Idioma novo: remonta o HTML inteiro (os textos vêm prontos); o "ready" dele repõe o estado.
        if (e.affectsConfiguration('shieldepy.language')) this.render(webviewView);
        else if (e.affectsConfiguration('shieldepy')) this.refreshAll();
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

  /** HTML do painel no idioma atual. */
  private render(webviewView: vscode.WebviewView): void {
    webviewView.title = t('panelTitle');
    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'panel',
      initial: { graphReady: this.model.graph.isReady, t: strings() },
      body: `
  <div id="lock" class="lock" hidden>
    ${mascot(this.extensionUri)}
    <h2 class="lock-title" id="lockTitle"></h2>
    <p class="lock-text" id="lockText"></p>
    <button id="lockAction" class="pill-btn"></button>
    <button id="lockSecondary" class="text-btn" hidden></button>
  </div>
  <main id="main">
    <header class="guard">
      <div class="guard-title" id="status">${escapeHtml(t('guardTitle'))}</div>
      <div class="guard-sub" id="statusSub"></div>
    </header>
    <div class="analyzing" id="analyzingRow"><span class="morph-shape"></span><span id="analyzingText"></span></div>
    <p class="notice" id="graphNotice" hidden>${escapeHtml(t('graphNotice'))}</p>
    <div class="tiles" id="stats" role="group" aria-label="${escapeHtml(t('filterGroup'))}">
      <button class="tile" data-severity="error" aria-pressed="false"><span class="tile-num" id="countError">0</span><span class="shape error" aria-hidden="true"></span><span class="tile-label">${escapeHtml(t('sevError'))}</span></button>
      <button class="tile" data-severity="warning" aria-pressed="false"><span class="tile-num" id="countWarning">0</span><span class="shape warning" aria-hidden="true"></span><span class="tile-label">${escapeHtml(t('sevWarning'))}</span></button>
      <button class="tile" data-severity="info" aria-pressed="false"><span class="tile-num" id="countInfo">0</span><span class="shape info" aria-hidden="true"></span><span class="tile-label">${escapeHtml(t('sevInfo'))}</span></button>
    </div>
    <h3 class="list-head">${escapeHtml(t('problems'))}</h3>
    <div id="findings" class="files"></div>
    <p class="summary" id="summary"></p>
  </main>`,
    });
  }

  private post(message: unknown): void {
    void this.view?.webview.postMessage(message);
  }

  private refreshAll(): void {
    const folders = this.auth.folderAccess();
    this.post({
      type: 'access',
      state: this.auth.accessState(),
      company: this.auth.getCachedMe()?.companyName ?? null,
      // Bloqueado: qual remote falta liberar (null = a pasta nem tem .git com remote).
      remote: folders.find((f) => !f.allowed && f.remote)?.remote ?? null,
      // Liberado: por qual projeto.
      project: folders.find((f) => f.allowed)?.project?.name ?? null,
    });
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
    if (!config.analysisEnabled() || !this.auth.canUse()) {
      this.post({ type: 'findingsByFile', groups: [], systemDisabled: !config.analysisEnabled(), counts: { error: 0, warning: 0, info: 0 } });
      return;
    }
    const texts = new Map<string, string[]>(); // cada arquivo é lido uma vez por atualização
    const groups = this.findings
      .getAllByFile()
      .map(({ fileId, findings }) => {
        const relative = vscode.workspace.asRelativePath(vscode.Uri.file(fileId));
        const slash = relative.lastIndexOf('/');
        const items = findings
          .map((f) => ({
            id: f.id,
            ref: this.findings.refOf(f.id),
            fileId,
            fileName: relative,
            line: f.startLine,
            severity: f.severity,
            message: f.message,
            impact: f.impact ?? '',
            source: f.source,
            // O balão mostra o código: a outra ponta numa colisão; o próprio trecho nos demais.
            conflicts: (f.related ?? []).map((r) => readSnippet(r, 2, texts)).filter((x) => x !== undefined),
            snippet: f.related?.length ? undefined : readSnippet({ file: fileId, line: f.startLine, message: '' }, 2, texts),
          }))
          .sort((a, b) => a.line - b.line);
        return {
          fileId,
          fileName: relative.slice(slash + 1),
          folder: slash > 0 ? relative.slice(0, slash) : '',
          worst: items.reduce((w, i) => (RANK[i.severity] > RANK[w] ? i.severity : w), 'info' as FindingSeverity),
          items,
        };
      })
      // Mais grave primeiro; empate, o que tem mais achados.
      .sort((a, b) => RANK[b.worst] - RANK[a.worst] || b.items.length - a.items.length);
    this.post({ type: 'findingsByFile', groups, systemDisabled: false, counts: this.findings.counts() });
  }
}

const RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Mascote "pensando" do site, inline (não <img>) pra o CSS recolorir braços e pernas conforme o
 * tema. O arquivo já vem sem o <script> de animação — a CSP do webview não deixaria rodar mesmo.
 * Sem o arquivo, cai no escudo simples.
 */
function mascot(extensionUri: vscode.Uri): string {
  try {
    return `<div class="lock-mascot">${readFileSync(vscode.Uri.joinPath(extensionUri, 'media', 'mascot-thinking.svg').fsPath, 'utf8')}</div>`;
  } catch {
    return '<span class="lock-mark" aria-hidden="true"></span>';
  }
}

async function revealLine(fileId: string, line: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(fileId), { preserveFocus: false });
  const position = new vscode.Position(Math.max(line, 0), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
