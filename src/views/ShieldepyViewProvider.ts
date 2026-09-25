import * as vscode from 'vscode';
import { GraphManager } from '../graph/GraphManager';
import { FindingsManager } from '../analysis/FindingsManager';
import type { StoredFinding } from '../analysis/types';
import { ChatViewProvider } from '../chat/ChatViewProvider';
import { AnalyzingDecorationProvider } from '../analysis/AnalyzingDecorationProvider';

/**
 * Painel da sidebar: switch pra ligar/desligar o helper de sugestões inline, e uma lista
 * em tempo real dos problemas encontrados no arquivo atualmente ativo (atualiza sozinha
 * conforme o BackgroundAnalyzer termina uma passada, ou quando o usuário troca de aba).
 */
export class ShieldepyViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'shieldepy.panel';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly findingsManager: FindingsManager,
    private readonly graphManager: GraphManager,
    private readonly chatViewProvider: ChatViewProvider,
    private readonly analyzingDecorations: AnalyzingDecorationProvider
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'toggle') {
        await vscode.workspace
          .getConfiguration('shieldepy')
          .update('inlineSuggestions.enabled', message.value, vscode.ConfigurationTarget.Global);
      } else if (message?.type === 'reveal') {
        await this.revealLine(message.uri, message.line);
      } else if (message?.type === 'askAI') {
        this.chatViewProvider.attachFinding(message.finding);
      } else if (message?.type === 'ready') {
        // O webview só registra seu listener de mensagem depois de carregar o <script>;
        // mandar os achados antes disso (ex: direto no resolveWebviewView) é uma corrida
        // real — a mensagem se perde e nada mais dispara outra tentativa. Esperar esse
        // "ready" garante que o primeiro envio chega depois do listener existir.
        this.refreshAllFindings();
        this.refreshAnalyzingStatus();
      }
    });

    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('shieldepy.inlineSuggestions.enabled')) {
        void webviewView.webview.postMessage({ type: 'syncToggle', value: this.isEnabled() });
      }
      if (e.affectsConfiguration('shieldepy.backgroundAnalysis.enabled')) {
        this.refreshAllFindings();
      }
    });

    const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(() => {
      this.refreshAnalyzingStatus();
    });
    const findingsListener = this.findingsManager.onDidChange(() => this.refreshAllFindings());
    const analyzingListener = this.analyzingDecorations.onDidChangeAnalyzing(({ uri }) => {
      const active = vscode.window.activeTextEditor?.document.uri;
      if (active && active.toString() === uri.toString()) this.refreshAnalyzingStatus();
    });

    webviewView.onDidDispose(() => {
      configListener.dispose();
      activeEditorListener.dispose();
      findingsListener.dispose();
      analyzingListener.dispose();
      this.view = undefined;
    });
  }

  private refreshAnalyzingStatus(): void {
    if (!this.view) return;
    const editor = vscode.window.activeTextEditor;
    const analyzing = Boolean(editor && this.analyzingDecorations.isAnalyzing(editor.document.uri));
    void this.view.webview.postMessage({
      type: 'analyzing',
      active: analyzing,
      fileName: editor ? editor.document.uri.path.split('/').pop() : null,
    });
  }

  private async revealLine(uriString: string, line: number): Promise<void> {
    const uri = vscode.Uri.parse(uriString);
    const editor = await vscode.window.showTextDocument(uri, { preserveFocus: false });
    const position = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  /** Uma "gaveta" por arquivo, ordenadas por quantidade de achados (mais problemático primeiro). */
  private refreshAllFindings(): void {
    if (!this.view) return;

    // Sistema desativado nas Configurações: some com os achados da página inicial, mesmo que
    // ainda existam no cache — desligar é pra deixar de ver, não só parar de gerar novo.
    const systemEnabled = vscode.workspace.getConfiguration('shieldepy').get<boolean>('backgroundAnalysis.enabled', true);
    if (!systemEnabled) {
      void this.view.webview.postMessage({ type: 'findingsByFile', groups: [], systemDisabled: true });
      return;
    }

    const groups = this.findingsManager
      .getAllByFile()
      .map((g) => ({
        uri: g.uri.toString(),
        fileName: vscode.workspace.asRelativePath(g.uri),
        items: g.findings.map((f) => this.serializeFinding(f, g.uri)).sort((a, b) => a.line - b.line),
      }))
      .sort((a, b) => b.items.length - a.items.length);

    void this.view.webview.postMessage({ type: 'findingsByFile', groups, systemDisabled: false });
  }

  private serializeFinding(finding: StoredFinding, uri: vscode.Uri) {
    return {
      id: finding.id,
      uri: uri.toString(),
      fileName: vscode.workspace.asRelativePath(uri),
      line: finding.range.start.line,
      severity: finding.severity,
      message: finding.message,
      impact: finding.impact ?? '',
      source: finding.source,
    };
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('shieldepy').get<boolean>('inlineSuggestions.enabled', true);
  }

  private render(): string {
    const enabled = this.isEnabled();
    const graphWarning = this.graphManager.isReady
      ? ''
      : `<div class="notice">Grafo indisponível — verifique se os arquivos .wasm do Tree-sitter estão em <code>wasm/</code> (veja o README) e reinicie a extensão.</div>`;

    return /* html */ `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<style>
  :root {
    --sd-error: #f85149;
    --sd-warning: #eab308;
    --sd-info: #3fb950;
    --sd-accent: #10ef7c;
  }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 12px;
  }
  h4 { margin: 20px 0 8px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); }
  .protect-row { display: flex; align-items: center; gap: 10px; padding-bottom: 4px; }
  .switch { position: relative; width: 34px; height: 18px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute; inset: 0; cursor: pointer;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, transparent));
    border-radius: 999px; transition: background .15s ease;
  }
  .slider::before {
    content: ""; position: absolute; height: 12px; width: 12px; left: 2px; top: 2px;
    background: var(--vscode-foreground); border-radius: 50%; transition: transform .15s ease;
  }
  input:checked + .slider { background: var(--sd-accent); }
  input:checked + .slider::before { transform: translateX(16px); background: #06210f; }
  .protect-label { font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); transition: color .15s ease; }
  .protect-label.active { color: var(--sd-accent); }
  .analyzing-row { display: none; align-items: center; gap: 8px; padding: 6px 0 2px; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .analyzing-row.visible { display: flex; }
  .morph-shape {
    width: 10px; height: 10px; flex-shrink: 0; background: var(--sd-accent);
    animation: sd-morph 2.4s ease-in-out infinite;
  }
  /* Mesmas 4 formas (16 vértices cada) validadas visualmente antes de entrar no código —
     o navegador interpola de verdade entre elas porque a contagem de pontos é idêntica. */
  @keyframes sd-morph {
    0%, 100% { clip-path: polygon(50.0% 2.0%, 68.4% 5.7%, 83.9% 16.1%, 94.3% 31.6%, 98.0% 50.0%, 94.3% 68.4%, 83.9% 83.9%, 68.4% 94.3%, 50.0% 98.0%, 31.6% 94.3%, 16.1% 83.9%, 5.7% 68.4%, 2.0% 50.0%, 5.7% 31.6%, 16.1% 16.1%, 31.6% 5.7%); }
    25%  { clip-path: polygon(50.0% 2.0%, 58.7% 19.4%, 67.4% 36.7%, 76.0% 54.1%, 84.7% 71.5%, 93.4% 88.8%, 88.8% 98.0%, 69.4% 98.0%, 50.0% 98.0%, 30.6% 98.0%, 11.2% 98.0%, 6.6% 88.8%, 15.3% 71.5%, 24.0% 54.1%, 32.6% 36.7%, 41.3% 19.4%); }
    50%  { clip-path: polygon(50.0% 2.0%, 62.0% 14.0%, 74.0% 26.0%, 86.0% 38.0%, 98.0% 50.0%, 86.0% 62.0%, 74.0% 74.0%, 62.0% 86.0%, 50.0% 98.0%, 38.0% 86.0%, 26.0% 74.0%, 14.0% 62.0%, 2.0% 50.0%, 14.0% 38.0%, 26.0% 26.0%, 38.0% 14.0%); }
    75%  { clip-path: polygon(50.0% 0.0%, 57.7% 31.5%, 85.4% 14.6%, 68.5% 42.3%, 100.0% 50.0%, 68.5% 57.7%, 85.4% 85.4%, 57.7% 68.5%, 50.0% 100.0%, 42.3% 68.5%, 14.6% 85.4%, 31.5% 57.7%, 0.0% 50.0%, 31.5% 42.3%, 14.6% 14.6%, 42.3% 31.5%); }
  }
  @media (prefers-reduced-motion: reduce) {
    .morph-shape { animation: none; clip-path: none; border-radius: 50%; }
  }
  .notice {
    font-size: 11px; line-height: 1.45; margin: 12px 0; padding: 2px 0 2px 10px;
    border-left: 3px solid var(--sd-warning);
    color: var(--vscode-descriptionForeground);
  }
  .empty { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .island {
    border: 1px solid var(--vscode-panel-border, transparent);
    border-radius: 6px;
    margin-bottom: 6px;
    overflow: hidden;
  }
  .island-header {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer;
    background: var(--vscode-list-hoverBackground, transparent);
    font-size: 12px; font-weight: 600;
  }
  .island-header:hover { background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground)); }
  .island-chevron {
    width: 8px; height: 8px; flex-shrink: 0; border-right: 2px solid var(--vscode-foreground);
    border-bottom: 2px solid var(--vscode-foreground); transform: rotate(-45deg); transition: transform .15s ease;
  }
  .island.expanded .island-chevron { transform: rotate(45deg); }
  .island-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .island-count {
    font-size: 10px; font-weight: 600; color: var(--vscode-editor-background);
    background: var(--sd-accent); border-radius: 999px; padding: 1px 7px; flex-shrink: 0;
  }
  .island-body { display: none; padding: 2px 10px 6px; }
  .island.expanded .island-body { display: block; }
  .finding {
    display: flex; gap: 8px; padding: 7px 0; cursor: pointer; align-items: flex-start;
    border-top: 1px solid var(--vscode-panel-border, transparent);
  }
  .finding:first-child { border-top: none; }
  .finding:hover .finding-message { color: var(--vscode-textLink-activeForeground); }
  .marker-wrap { position: relative; display: inline-flex; margin-top: 4px; flex-shrink: 0; }
  .marker { width: 9px; height: 9px; margin-top: 0; flex-shrink: 0; }
  .marker.error { background: var(--sd-error); clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%); }
  .marker.warning { background: var(--sd-warning); clip-path: polygon(50% 5%, 100% 95%, 0% 95%); }
  .marker.info { background: var(--sd-info); border-radius: 50%; }
  .marker-tooltip {
    position: absolute; left: 14px; top: -5px; z-index: 20;
    background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-panel-border));
    border-radius: 4px; padding: 3px 8px; font-size: 11px; font-weight: 500; white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
    opacity: 0; visibility: hidden; transform: translateY(2px);
    transition: opacity .12s ease, transform .12s ease; pointer-events: none;
  }
  .marker-wrap:hover .marker-tooltip { opacity: 1; visibility: visible; transform: translateY(0); }
  .finding-body { min-width: 0; flex: 1; }
  .finding-line { font-size: 10px; font-family: var(--vscode-editor-font-family, monospace); color: var(--vscode-descriptionForeground); }
  .finding-message { font-size: 12px; line-height: 1.4; word-wrap: break-word; }
  .ask-ai-btn {
    font-size: 10px; background: transparent; color: var(--vscode-textLink-foreground);
    border: none; padding: 2px 0; margin-top: 2px; text-decoration: underline; text-underline-offset: 2px;
    cursor: pointer; align-self: flex-start; flex-shrink: 0; white-space: nowrap;
  }
  .ask-ai-btn:hover { color: var(--vscode-textLink-activeForeground); }
</style>
</head>
<body>
  <div class="protect-row">
    <label class="switch">
      <input type="checkbox" id="toggle" ${enabled ? 'checked' : ''} />
      <span class="slider"></span>
    </label>
    <span class="protect-label${enabled ? ' active' : ''}" id="status">${enabled ? 'Protegendo' : 'Pausado'}</span>
  </div>
  <div class="analyzing-row" id="analyzingRow">
    <span class="morph-shape"></span>
    <span id="analyzingText"></span>
  </div>
  ${graphWarning}

  <h4>Problemas encontrados</h4>
  <div id="findings"><div class="empty">Nenhum problema encontrado ainda.</div></div>

<script>
  const vscode = acquireVsCodeApi();
  const toggle = document.getElementById('toggle');
  const status = document.getElementById('status');
  const findingsEl = document.getElementById('findings');
  const analyzingRow = document.getElementById('analyzingRow');
  const analyzingText = document.getElementById('analyzingText');
  const expandedFiles = new Set(); // sobrevive a re-renders — lembra quais gavetas o usuário abriu
  const SEVERITY_LABELS = { error: 'Importante', warning: 'Warning', info: 'Ajuste leve' };

  toggle.addEventListener('change', () => {
    vscode.postMessage({ type: 'toggle', value: toggle.checked });
    status.textContent = toggle.checked ? 'Protegendo' : 'Pausado';
    status.classList.toggle('active', toggle.checked);
  });

  function renderFindingRow(item) {
    const row = document.createElement('div');
    row.className = 'finding';
    row.innerHTML = \`
      <span class="marker-wrap">
        <span class="marker \${item.severity}"></span>
        <span class="marker-tooltip">\${SEVERITY_LABELS[item.severity] || item.severity}</span>
      </span>
      <span class="finding-body">
        <div class="finding-line">Linha \${item.line + 1} · #\${item.id}</div>
        <div class="finding-message">\${escapeHtml(item.message)}</div>
      </span>
    \`;
    row.title = item.impact ? 'Impacto: ' + item.impact : '';
    row.addEventListener('click', () => {
      vscode.postMessage({ type: 'reveal', uri: item.uri, line: item.line });
    });

    const askBtn = document.createElement('button');
    askBtn.className = 'ask-ai-btn';
    askBtn.textContent = 'Ask AI';
    askBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      vscode.postMessage({ type: 'askAI', finding: item });
    });
    row.appendChild(askBtn);
    return row;
  }

  function renderFindingsByFile(groups, systemDisabled) {
    if (systemDisabled) {
      findingsEl.innerHTML = '<div class="empty">Sistema desativado — ative em Configurações (ícone escudo + engrenagem na barra lateral).</div>';
      return;
    }
    if (!groups || groups.length === 0) {
      findingsEl.innerHTML = '<div class="empty">Nenhum problema encontrado ainda.</div>';
      return;
    }

    findingsEl.innerHTML = '';
    for (const group of groups) {
      const island = document.createElement('div');
      island.className = 'island' + (expandedFiles.has(group.uri) ? ' expanded' : '');

      const header = document.createElement('div');
      header.className = 'island-header';
      header.innerHTML = \`
        <span class="island-chevron"></span>
        <span class="island-name">\${escapeHtml(group.fileName)}</span>
        <span class="island-count">\${group.items.length}</span>
      \`;
      header.addEventListener('click', () => {
        const isExpanded = island.classList.toggle('expanded');
        if (isExpanded) expandedFiles.add(group.uri); else expandedFiles.delete(group.uri);
      });

      const body = document.createElement('div');
      body.className = 'island-body';
      for (const item of group.items) body.appendChild(renderFindingRow(item));

      island.appendChild(header);
      island.appendChild(body);
      findingsEl.appendChild(island);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'syncToggle') {
      toggle.checked = msg.value;
      status.textContent = msg.value ? 'Protegendo' : 'Pausado';
      status.classList.toggle('active', msg.value);
    } else if (msg?.type === 'findingsByFile') {
      renderFindingsByFile(msg.groups, msg.systemDisabled);
    } else if (msg?.type === 'analyzing') {
      analyzingRow.classList.toggle('visible', Boolean(msg.active));
      analyzingText.textContent = msg.active ? ('Analisando ' + (msg.fileName || '')) : '';
    }
  });

  // Avisa a extensão que o listener acima já existe — só a partir daqui é seguro
  // mandar a lista inicial de achados sem correr risco de a mensagem se perder.
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
