import * as vscode from 'vscode';
import { toFileId } from '@shieldepy/core';
import type { FindingsManager } from '../analysis/FindingsManager';

/**
 * Clicar numa linha com colisão abre o balão (o hover do achado) mostrando o código da outra
 * ponta — sem precisar parar o mouse em cima. Só reage a clique de mouse e uma vez por linha,
 * pra não ficar reabrindo enquanto a pessoa edita dentro da mesma linha.
 */
export class ConflictBalloon implements vscode.Disposable {
  private lastShown: string | undefined;
  private readonly listener: vscode.Disposable;

  constructor(private readonly findings: FindingsManager) {
    this.listener = vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e));
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    const { textEditor: editor, selections } = e;
    if (editor.document.uri.scheme !== 'file' || selections.length !== 1) return;
    const line = selections[0]!.active.line;
    const spot = `${editor.document.uri.toString()}#${line}`;

    if (e.kind !== vscode.TextEditorSelectionChangeKind.Mouse || !selections[0]!.isEmpty) {
      if (spot !== this.lastShown) this.lastShown = undefined; // saiu da linha: o próximo clique nela abre de novo
      return;
    }
    if (spot === this.lastShown) return;
    if (this.findings.conflictsAt(toFileId(editor.document.uri.fsPath), line).length === 0) {
      this.lastShown = undefined;
      return;
    }
    this.lastShown = spot;
    void vscode.commands.executeCommand('editor.action.showHover', { focus: 'noAutoFocus' });
  }

  dispose(): void {
    this.listener.dispose();
  }
}

/** Abre um arquivo na linha pedida, centralizada, com o cursor no começo do código da linha. */
export async function openLocation(file: string, line: number): Promise<void> {
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
  const safe = Math.min(Math.max(Number(line) || 0, 0), Math.max(editor.document.lineCount - 1, 0));
  const position = new vscode.Position(safe, editor.document.lineAt(safe).firstNonWhitespaceCharacterIndex);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
