import * as vscode from 'vscode';

const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
];

/**
 * Aba de configurações — separada do painel principal de propósito, com ícone próprio
 * (escudo + engrenagem) na activity bar. Por enquanto só tem duas coisas: ligar/desligar o
 * sistema de análise por completo, e escolher o idioma em que a IA escreve achados e respostas
 * (não traduz a interface da extensão — isso é uma etapa futura separada).
 */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'shieldepy.settings';

  private view: vscode.WebviewView | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.render();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'toggleSystem') {
        await vscode.workspace
          .getConfiguration('shieldepy')
          .update('backgroundAnalysis.enabled', message.value, vscode.ConfigurationTarget.Global);
      } else if (message?.type === 'setLanguage') {
        await vscode.workspace
          .getConfiguration('shieldepy')
          .update('language', message.value, vscode.ConfigurationTarget.Global);
      }
    });

    const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('shieldepy.backgroundAnalysis.enabled') || e.affectsConfiguration('shieldepy.language')) {
        void webviewView.webview.postMessage({
          type: 'sync',
          systemEnabled: this.isSystemEnabled(),
          language: this.currentLanguage(),
        });
      }
    });

    webviewView.onDidDispose(() => {
      configListener.dispose();
      this.view = undefined;
    });
  }

  private isSystemEnabled(): boolean {
    return vscode.workspace.getConfiguration('shieldepy').get<boolean>('backgroundAnalysis.enabled', true);
  }

  private currentLanguage(): string {
    return vscode.workspace.getConfiguration('shieldepy').get<string>('language', 'pt-BR');
  }

  private render(): string {
    const systemEnabled = this.isSystemEnabled();
    const currentLang = this.currentLanguage();

    const languageItems = LANGUAGES.map(
      (lang) => /* html */ `
      <label class="lang-row">
        <input type="radio" name="language" value="${lang.code}" ${lang.code === currentLang ? 'checked' : ''} />
        <span>${lang.label}</span>
      </label>`
    ).join('');

    return /* html */ `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8" />
<style>
  :root { --sd-accent: #10ef7c; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 12px;
  }
  h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); }
  p.hint { margin: 0 0 12px; font-size: 11px; line-height: 1.4; color: var(--vscode-descriptionForeground); }
  section { margin-bottom: 22px; }
  .toggle-row { display: flex; align-items: center; gap: 10px; }
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
  .toggle-label { font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); }
  .toggle-label.active { color: var(--sd-accent); }
  .lang-row {
    display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 4px;
    cursor: pointer; font-size: 12px;
  }
  .lang-row:hover { background: var(--vscode-list-hoverBackground); }
  .lang-row input { accent-color: var(--sd-accent); }
</style>
</head>
<body>
  <section>
    <h4>Sistema</h4>
    <div class="toggle-row">
      <label class="switch">
        <input type="checkbox" id="systemToggle" ${systemEnabled ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
      <span class="toggle-label${systemEnabled ? ' active' : ''}" id="systemLabel">${systemEnabled ? 'Ativo' : 'Desativado'}</span>
    </div>
    <p class="hint">Desativar remove a análise automática e os achados da página inicial — o helper de sugestão inline continua controlável separadamente ali.</p>
  </section>

  <section>
    <h4>Idioma da IA</h4>
    <p class="hint">Idioma usado pra escrever achados e respostas do chat. Não traduz botões nem rótulos da extensão.</p>
    ${languageItems}
  </section>

<script>
  const vscode = acquireVsCodeApi();
  const systemToggle = document.getElementById('systemToggle');
  const systemLabel = document.getElementById('systemLabel');

  systemToggle.addEventListener('change', () => {
    vscode.postMessage({ type: 'toggleSystem', value: systemToggle.checked });
    systemLabel.textContent = systemToggle.checked ? 'Ativo' : 'Desativado';
    systemLabel.classList.toggle('active', systemToggle.checked);
  });

  document.querySelectorAll('input[name="language"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) vscode.postMessage({ type: 'setLanguage', value: input.value });
    });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'sync') {
      systemToggle.checked = msg.systemEnabled;
      systemLabel.textContent = msg.systemEnabled ? 'Ativo' : 'Desativado';
      systemLabel.classList.toggle('active', msg.systemEnabled);
      document.querySelectorAll('input[name="language"]').forEach((input) => {
        input.checked = input.value === msg.language;
      });
    }
  });
</script>
</body>
</html>`;
  }
}
