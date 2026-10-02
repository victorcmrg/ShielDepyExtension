import * as vscode from 'vscode';
import { toFileId, type FindingSeverity } from '@shieldepy/core';
import type { AnalyzingDecorationProvider } from '../analysis/AnalyzingDecorationProvider';
import type { FindingsManager } from '../analysis/FindingsManager';
import { t } from '../i18n';

const GLYPH: Record<FindingSeverity, string> = { error: '■', warning: '▲', info: '●' };
const COLOR: Record<FindingSeverity, string> = {
  error: 'shieldepy.importantForeground',
  warning: 'shieldepy.attentionForeground',
  info: 'shieldepy.lightForeground',
};
const NAME_KEY: Record<FindingSeverity, 'sevError' | 'sevWarning' | 'sevInfo'> = { error: 'sevError', warning: 'sevWarning', info: 'sevInfo' };
const RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, error: 2 };

/**
 * Único dono da decoração dos arquivos no Explorer (e nas abas/listas de arquivos):
 *   - com achados: a forma da severidade mais grave (■ ▲ ●) na cor dela, e a pasta herda a cor
 *   - analisando: a forma anima, mas a COR continua a dos achados (ou verde, se ainda não há)
 * Um provedor só, de propósito: com dois (análise + achados) o arquivo ficava um instante sem
 * decoração na troca e piscava branco.
 */
export class ExplorerDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly findings: FindingsManager,
    private readonly analyzing: AnalyzingDecorationProvider
  ) {
    this.listeners = [
      findings.onDidChange((fileId) => this.emitter.fire(vscode.Uri.file(fileId))),
      analyzing.onDidChangeFrame((uri) => this.emitter.fire(uri)),
      // Idioma novo: as dicas de todos os arquivos mudam.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('shieldepy.language')) this.emitter.fire(undefined);
      }),
    ];
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'file') return undefined;
    const found = this.findings.get(toFileId(uri.fsPath));
    const frame = this.analyzing.frameOf(uri);
    if (found.length === 0 && !frame) return undefined;

    if (found.length === 0) {
      return new vscode.FileDecoration(frame, t('explorerAnalyzing'), new vscode.ThemeColor('shieldepy.analyzingForeground'));
    }

    const counts: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const f of found) counts[f.severity] += 1;
    const worst = (Object.keys(counts) as FindingSeverity[]).reduce((w, s) => (counts[s] > 0 && RANK[s] > RANK[w] ? s : w), 'info');
    const parts = (['error', 'warning', 'info'] as FindingSeverity[])
      .filter((s) => counts[s] > 0)
      .map((s) => `${t(NAME_KEY[s])}: ${counts[s]}`);
    const decoration = new vscode.FileDecoration(
      frame ?? GLYPH[worst],
      `ShielDepy: ${parts.join(', ')}${frame ? t('explorerAnalyzingSuffix') : ''}`,
      new vscode.ThemeColor(COLOR[worst])
    );
    decoration.propagate = true; // a pasta também fica na cor — dá pra achar o arquivo com a árvore fechada
    return decoration;
  }

  dispose(): void {
    for (const l of this.listeners) l.dispose();
    this.emitter.dispose();
  }
}
