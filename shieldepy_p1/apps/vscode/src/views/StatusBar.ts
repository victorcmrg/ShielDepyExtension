import * as vscode from 'vscode';
import type { AnalyzingDecorationProvider } from '../analysis/AnalyzingDecorationProvider';
import type { FindingsManager } from '../analysis/FindingsManager';
import { config } from '../config';
import { CMD } from '../constants';
import { t } from '../i18n';
import type { AuthService } from '../services/AuthService';

/**
 * Item da barra de status: mostra de relance se a extensão está liberada, analisando, e quantos
 * achados há. O clique leva pro que faz sentido no estado atual (entrar, painel web, ou o painel).
 */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly disposables: vscode.Disposable[];

  constructor(
    private readonly auth: AuthService,
    private readonly findings: FindingsManager,
    private readonly analyzing: AnalyzingDecorationProvider
  ) {
    this.item.name = 'ShielDepy';
    this.disposables = [
      auth.onDidChangeAuth(() => this.render()),
      findings.onDidChange(() => this.render()),
      analyzing.onDidChangeAnalyzing(() => this.render()),
      vscode.window.onDidChangeActiveTextEditor(() => this.render()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('shieldepy')) this.render();
      }),
    ];
    this.render();
  }

  private render(): void {
    if (!config.statusBarEnabled()) {
      this.item.hide();
      return;
    }
    const state = this.auth.accessState();
    this.item.backgroundColor = undefined;

    if (state === 'loggedOut') {
      this.item.text = `$(lock) ${t('sbSignIn')}`;
      this.item.tooltip = t('sbSignInTip');
      this.item.command = CMD.login;
    } else if (state === 'suspended') {
      this.item.text = `$(circle-slash) ${t('sbSuspended')}`;
      this.item.tooltip = t('sbSuspendedTip', { company: this.auth.getCachedMe()?.companyName ?? t('yourCompany') });
      this.item.command = CMD.refreshAccess;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (!config.analysisEnabled()) {
      this.item.text = `$(shield) ${t('sbPaused')}`;
      this.item.tooltip = t('sbPausedTip');
      this.item.command = CMD.focusPanel;
    } else {
      const editor = vscode.window.activeTextEditor;
      const busy = Boolean(editor && this.analyzing.isAnalyzing(editor.document.uri));
      const { error, warning, info } = this.findings.counts();
      const total = error + warning + info;
      this.item.text = busy
        ? '$(sync~spin) ShielDepy'
        : total === 0
          ? '$(shield) ShielDepy $(check)'
          : `$(shield) $(error) ${error}  $(warning) ${warning}  $(info) ${info}`;
      const trigger = config.analysisTrigger() === 'onSave' ? t('sbTriggerOnSave') : t('sbTriggerOnType');
      this.item.tooltip = `${this.auth.getCachedMe()?.companyName ?? 'ShielDepy'}\n${t('sbActiveTip', { trigger, n: total })}`;
      this.item.command = CMD.focusPanel;
      if (error > 0) this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.item.dispose();
  }
}
