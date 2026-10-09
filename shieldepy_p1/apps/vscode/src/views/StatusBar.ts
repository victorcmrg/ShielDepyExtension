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
    this.item.backgroundColor = undefined;
    this.item.command = CMD.focusPanel;
    // A conta não trava nada (modo local): ela só aparece na dica, e a IA da empresa desligada também.
    const me = this.auth.getCachedMe();
    const who = me ? me.companyName : t('sbLocalTip');
    const aiOff = this.auth.companyAiBlock() ? `\n${t('sbAiOff')}` : '';

    if (!config.analysisEnabled()) {
      this.item.text = `$(shield) ${t('sbPaused')}`;
      this.item.tooltip = `${who}\n${t('sbPausedTip')}`;
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
      this.item.tooltip = `${who}\n${t('sbActiveTip', { trigger, n: total })}${aiOff}`;
      if (error > 0) this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.item.dispose();
  }
}
