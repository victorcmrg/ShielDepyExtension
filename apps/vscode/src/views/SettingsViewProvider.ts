import * as vscode from 'vscode';
import { config } from '../config';
import { CMD } from '../constants';
import { strings, t, type Key } from '../i18n';
import type { AiService } from '../services/AiService';
import type { AuthService } from '../services/AuthService';
import { escapeHtml, renderWebview } from './webview';

// Nomes de idioma ficam no próprio idioma: quem procura "English" acha mesmo com a interface em russo.
const LANGUAGES = [
  { code: 'pt-BR', label: 'Português (Brasil)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
];

const PROVIDERS: Array<{ code: string; label?: string; labelKey?: Key; hintKey?: Key }> = [
  { code: 'auto', labelKey: 'provAuto', hintKey: 'provAutoHint' },
  { code: 'anthropic', label: 'Claude (Anthropic)' },
  { code: 'gemini', label: 'Gemini (Google)' },
  { code: 'offline', labelKey: 'provOffline', hintKey: 'provOfflineHint' },
];

const TRIGGERS: Array<{ code: string; labelKey: Key; shortKey: Key; hintKey: Key }> = [
  { code: 'onType', labelKey: 'triggerOnType', shortKey: 'triggerOnTypeShort', hintKey: 'triggerOnTypeHint' },
  { code: 'onSave', labelKey: 'triggerOnSave', shortKey: 'triggerOnSaveShort', hintKey: 'triggerOnSaveHint' },
];

const SEVERITIES: Array<{ code: string; labelKey: Key }> = [
  { code: 'info', labelKey: 'sevAll' },
  { code: 'warning', labelKey: 'sevNoMinor' },
  { code: 'error', labelKey: 'sevImportantOnly' },
];

const IDLE_MIN = 300;
const IDLE_MAX = 5000;
const MAX_EXCLUDES = 50;

/** Aba de configurações: conta, sistema on/off, quando analisar, filtros, IA e idioma. */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly ai: AiService,
    private readonly auth: AuthService
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] };
    this.render(webviewView);

    const sync = async () =>
      webviewView.webview.postMessage({
        type: 'sync',
        systemEnabled: config.analysisEnabled(),
        inlineEnabled: config.inlineEnabled(),
        language: config.languageCode(),
        provider: config.aiProvider(),
        engine: await this.ai.engine(),
        me: this.auth.getCachedMe(),
        portal: config.hasPortal(),
        access: this.auth.accessState(),
        project: this.auth.folderAccess().find((f) => f.allowed)?.project?.name ?? null,
        trigger: config.analysisTrigger(),
        idleMs: config.idleMs(),
        minSeverity: config.minSeverity(),
        exclude: config.excludeGlobs(),
        statusBar: config.statusBarEnabled(),
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
          case 'toggleInline':
            await config.update('inlineSuggestions.enabled', Boolean(message.value));
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
          case 'login':
            await vscode.commands.executeCommand(CMD.login);
            break;
          case 'logout':
            await vscode.commands.executeCommand(CMD.logout);
            break;
          case 'openDashboard':
            await vscode.commands.executeCommand(CMD.openDashboard);
            break;
          case 'refreshAccess':
            await vscode.commands.executeCommand(CMD.refreshAccess);
            await sync();
            break;
          case 'setTrigger':
            if (TRIGGERS.some((tr) => tr.code === message.value)) await config.update('backgroundAnalysis.trigger', message.value);
            break;
          case 'setIdle': {
            const ms = Math.round(Number(message.value));
            if (Number.isFinite(ms)) await config.update('backgroundAnalysis.idleMs', Math.min(Math.max(ms, IDLE_MIN), IDLE_MAX));
            break;
          }
          case 'setMinSeverity':
            if (SEVERITIES.some((s) => s.code === message.value)) await config.update('display.minSeverity', message.value);
            break;
          case 'setExclude':
            if (Array.isArray(message.value)) {
              const globs = message.value
                .map((g: unknown) => String(g).trim())
                .filter((g: string) => g.length > 0 && g.length <= 200)
                .slice(0, MAX_EXCLUDES);
              await config.update('analysis.exclude', globs);
            }
            break;
          case 'toggleStatusBar':
            await config.update('statusBar.enabled', Boolean(message.value));
            break;
        }
      }),
      this.auth.onDidChangeAuth(() => void sync()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // Idioma novo: remonta com os textos traduzidos (o "ready" do HTML novo pede o estado).
        if (e.affectsConfiguration('shieldepy.language')) this.render(webviewView);
        else if (e.affectsConfiguration('shieldepy')) void sync();
      }),
      this.ai.onDidChange(() => void sync()),
    ];
    webviewView.onDidDispose(() => disposables.forEach((d) => d.dispose()));
  }

  private render(webviewView: vscode.WebviewView): void {
    const h = (key: Key) => escapeHtml(t(key));
    const drawer = (id: string, labelKey: Key, inner: string) => `
    <div class="drawer" data-drawer="${id}">
      <button class="row row-button" aria-expanded="false"><span class="row-label">${h(labelKey)}</span><span class="row-value" id="${id}Value"></span><span class="disclosure"></span></button>
      <div class="drawer-body"><div class="drawer-inner">${inner}</div></div>
    </div>`;
    const toggle = (id: string, labelKey: Key) => `
    <div class="row">
      <span class="row-label">${h(labelKey)}</span>
      <label class="switch"><input type="checkbox" id="${id}" aria-label="${h(labelKey)}" /><span class="slider"></span></label>
    </div>`;

    webviewView.webview.html = renderWebview({
      webview: webviewView.webview,
      extensionUri: this.extensionUri,
      asset: 'settings',
      initial: {
        t: strings(),
        languages: LANGUAGES,
        providers: PROVIDERS.map((p) => ({ code: p.code, label: p.label ?? t(p.labelKey!), hint: p.hintKey ? t(p.hintKey) : '' })),
        triggers: TRIGGERS.map((tr) => ({ code: tr.code, label: t(tr.labelKey), short: t(tr.shortKey), hint: t(tr.hintKey) })),
        severities: SEVERITIES.map((s) => ({ code: s.code, label: t(s.labelKey) })),
        idleMin: IDLE_MIN,
        idleMax: IDLE_MAX,
      },
      body: `
  <section class="account" id="accountCard">
    <div class="account-head">
      <span class="avatar" id="accountAvatar" aria-hidden="true"></span>
      <div class="account-id">
        <div class="account-email" id="accountEmail"></div>
        <div class="account-company" id="accountCompany"></div>
      </div>
      <span class="state" id="accountBadge"></span>
    </div>
    <p class="account-hint" id="accountHint" hidden></p>
    <div class="account-login" id="loginRow" hidden><button id="loginBtn" class="pill-btn">${h('signIn')}</button></div>
    <div class="account-actions" id="accountActions" hidden>
      <button class="row row-button" id="dashboardBtn"><span class="row-label">${h('accountDashboard')}</span><span class="external" aria-hidden="true"></span></button>
      <button class="row row-button" id="refreshBtn"><span class="row-label" id="refreshLabel">${h('checkAccess')}</span></button>
      <button class="row row-button danger" id="logoutBtn"><span class="row-label">${h('signOut')}</span></button>
    </div>
  </section>

  <h3 class="group-title">${h('groupAnalysis')}</h3>
  <div class="group">${toggle('systemToggle', 'autoAnalysis')}${toggle('inlineToggle', 'inlineSuggestions')}${drawer(
    'trigger',
    'whenAnalyze',
    `<div class="choices" id="triggers"></div>
        <div class="range" id="idleRow">
          <div class="range-head"><label for="idleRange">${h('waitAfterTyping')}</label><output id="idleValue"></output></div>
          <input type="range" id="idleRange" step="100" />
        </div>`
  )}${drawer(
    'severity',
    'show',
    `<div class="segmented" id="severities" role="radiogroup" aria-label="${h('show')}"></div>
        <p class="note">${h('showNote')}</p>`
  )}${drawer(
    'exclude',
    'ignoreFiles',
    `<textarea id="excludeBox" rows="3" spellcheck="false" placeholder="**/*.test.ts" aria-label="${h('ignorePatterns')}"></textarea>
        <div class="inline-actions">
          <span class="note">${h('ignoreNote')}</span>
          <button id="excludeSave" class="pill-btn small" disabled>${h('save')}</button>
        </div>`
  )}
  </div>

  <h3 class="group-title">${h('groupAnswers')}</h3>
  <div class="group">${drawer(
    'provider',
    'whoExplains',
    `<div class="choices" id="providers"></div>
        <div class="inline-actions">
          <span class="note" id="engineStatus"></span>
          <button id="keyBtn" class="text-btn">${h('configureKey')}</button>
        </div>`
  )}${drawer('language', 'language', '<div class="choices" id="languages"></div>')}
  </div>

  <h3 class="group-title">${h('groupAppearance')}</h3>
  <div class="group">${toggle('statusBarToggle', 'showStatusBar')}
  </div>`,
    });
  }
}
