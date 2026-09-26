import * as vscode from 'vscode';
import { config } from '../config';
import { CMD } from '../constants';
import type { AiService } from '../services/AiService';
import { renderWebview } from './webview';

const LANGUAGES = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
];

const PROVIDERS = [
  { code: 'auto', label: 'Automático (primeira chave configurada)' },
  { code: 'anthropic', label: 'Claude (Anthropic)' },
  { code: 'gemini', label: 'Gemini (Google)' },
  { code: 'offline', label: 'Offline — só achados provados, sem IA' },
];

/** Aba de configurações: sistema on/off, qual IA explica, idioma das respostas. */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ai: AiService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'settings',
      initial: { languages: LANGUAGES, providers: PROVIDERS },
      body: `
  <section>
    <h4>Sistema</h4>
    <div class="toggle-row">
      <label class="switch"><input type="checkbox" id="systemToggle" /><span class="slider"></span></label>
      <span class="toggle-label" id="systemLabel"></span>
    </div>
    <p class="hint">Desativar remove a análise automática e os achados da página inicial — a sugestão inline é controlada separadamente ali.</p>
  </section>
  <section>
    <h4>IA</h4>
    <p class="hint">Ciclos e colisões são provados sem IA em qualquer modo. A IA só explica, conversa e sugere correções.</p>
    <div id="providers"></div>
    <p class="hint" id="engineStatus"></p>
    <button id="keyBtn">Configurar chave…</button>
  </section>
  <section>
    <h4>Idioma da IA</h4>
    <p class="hint">Idioma dos achados e das respostas do chat. Não traduz botões nem rótulos.</p>
    <div id="languages"></div>
  </section>`,
    });

    const sync = async () =>
      webviewView.webview.postMessage({
        type: 'sync',
        systemEnabled: config.analysisEnabled(),
        language: config.languageCode(),
        provider: config.aiProvider(),
        engine: await this.ai.engine(),
      });

    const disposables = [
      webviewView.webview.onDidReceiveMessage(async (message) => {
        switch (message?.type) {
          case 'ready':
            await sync();
            break;
          case 'toggleSystem':
            await config.update('backgroundAnalysis.enabled', Boolean(message.value));
            break;
          case 'setLanguage':
            if (LANGUAGES.some((l) => l.code === message.value)) await config.update('language', message.value);
            break;
          case 'setProvider':
            if (PROVIDERS.some((p) => p.code === message.value)) await config.update('aiProvider', message.value);
            break;
          case 'configureKey':
            await vscode.commands.executeCommand(CMD.setApiKey);
            break;
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('shieldepy')) void sync();
      }),
      this.ai.onDidChange(() => void sync()),
    ];
    webviewView.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }
}
