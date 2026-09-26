import * as vscode from 'vscode';
import type { SyntaxNode, TsParser } from '@shieldepy/core';

const STEP_MS = 260;
const MIN_VISIBLE_MS = 900; // pelo menos ~3 passos visíveis, mesmo se a chamada real responder rápido demais

/**
 * Overlay verde leve que "anda" pela região sendo analisada enquanto espera a IA — usa a árvore
 * real do Tree-sitter: o bloco inteiro, depois cada statement; num if/else, entra em cada ramo.
 * A árvore só é usada pra calcular os passos e é liberada na hora (antes vazava memória WASM).
 */
export class ScanAnimator implements vscode.Disposable {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(16, 239, 124, 0.10)' });
  private readonly sessions = new Map<string, number>();
  private readonly startedAt = new Map<string, number>();

  run(editor: vscode.TextEditor, parser: TsParser, startLine: number, endLine: number): void {
    const key = editor.document.uri.toString();
    const mySession = (this.sessions.get(key) ?? 0) + 1;
    this.sessions.set(key, mySession);
    this.startedAt.set(key, Date.now());

    let steps: vscode.Range[] = [];
    try {
      const jsx = /\.(tsx|jsx)$/i.test(editor.document.fileName);
      steps = parser.withTree(editor.document.getText(), jsx, (root) => buildSteps(root, startLine, endLine));
    } catch {
      steps = [];
    }
    if (steps.length === 0) steps.push(new vscode.Range(startLine, 0, Math.max(endLine, startLine), 0));

    let index = 0;
    const tick = () => {
      if (this.sessions.get(key) !== mySession) return; // stop() foi chamado, ou uma análise nova assumiu
      editor.setDecorations(this.decorationType, [steps[index % steps.length]!]);
      index++;
      setTimeout(tick, STEP_MS);
    };
    tick();
  }

  stop(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    const mySession = (this.sessions.get(key) ?? 0) + 1;
    this.sessions.set(key, mySession);

    const remaining = MIN_VISIBLE_MS - (Date.now() - (this.startedAt.get(key) ?? 0));
    const clear = () => {
      if (this.sessions.get(key) === mySession) editor.setDecorations(this.decorationType, []);
    };
    if (remaining > 0) setTimeout(clear, remaining);
    else clear();
  }

  dispose(): void {
    this.sessions.clear();
    this.decorationType.dispose();
  }
}

function buildSteps(root: SyntaxNode, startLine: number, endLine: number): vscode.Range[] {
  const target = root.descendantForPosition({ row: startLine, column: 0 }, { row: endLine, column: 0 });
  if (!target) return [];

  let block: SyntaxNode = target;
  while (block.parent && block.type !== 'statement_block' && block.type !== 'program') block = block.parent;

  const steps: vscode.Range[] = [];
  for (const child of block.namedChildren) {
    if (child.endPosition.row < startLine || child.startPosition.row > endLine) continue;
    steps.push(toRange(child));
    if (child.type === 'if_statement') {
      const consequence = child.childForFieldName('consequence');
      if (consequence) steps.push(toRange(consequence), ...consequence.namedChildren.map(toRange));
      const alternative = child.childForFieldName('alternative');
      const branch = alternative?.type === 'else_clause' ? alternative.namedChildren[0] : alternative;
      if (branch) steps.push(toRange(branch), ...branch.namedChildren.map(toRange));
    }
  }
  return steps;
}

function toRange(node: SyntaxNode): vscode.Range {
  return new vscode.Range(node.startPosition.row, node.startPosition.column, node.endPosition.row, node.endPosition.column);
}
