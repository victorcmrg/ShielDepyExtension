import * as vscode from 'vscode';
import type Parser from 'web-tree-sitter';

const STEP_MS = 260;
const MIN_VISIBLE_MS = 900; // pelo menos ~3 passos visíveis, mesmo se a chamada real falhar/responder rápido demais

/**
 * Overlay verde bem leve (10% de opacidade) que "anda" pela região sendo analisada enquanto
 * espera a resposta do Haiku — usa a árvore real do Tree-sitter, não uma animação de enfeite:
 * pinta o bloco inteiro primeiro, depois foca em cada statement; se algum for um if/else,
 * entra no if (bloco inteiro, depois cada ponto dele), depois no else do mesmo jeito. Cada
 * passo some antes do próximo aparecer. Roda em loop até `stop()` ser chamado.
 */
export class ScanAnimator {
  private readonly decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(16, 239, 124, 0.10)',
    isWholeLine: false,
  });

  private readonly sessions = new Map<string, number>();
  private readonly startedAt = new Map<string, number>();

  run(editor: vscode.TextEditor, tree: Parser.Tree, startLine: number, endLine: number): void {
    const key = editor.document.uri.toString();
    const mySession = (this.sessions.get(key) ?? 0) + 1;
    this.sessions.set(key, mySession);
    this.startedAt.set(key, Date.now());

    const steps = this.buildSteps(tree, startLine, endLine);
    if (steps.length === 0) {
      steps.push(new vscode.Range(startLine, 0, Math.max(endLine, startLine), 0));
    }

    let index = 0;
    const tick = () => {
      if (this.sessions.get(key) !== mySession) return; // stop() foi chamado, ou uma análise nova assumiu
      editor.setDecorations(this.decorationType, [steps[index % steps.length]]);
      index++;
      setTimeout(tick, STEP_MS);
    };
    tick();
  }

  /**
   * Se a chamada real (sucesso ou erro) terminar rápido demais — ex: erro de autenticação
   * que rejeita quase instantaneamente — a animação sumiria antes de dar pra perceber sequer
   * um quadro. Garante um mínimo de tempo visível independente de quão rápido a IA respondeu.
   */
  stop(editor: vscode.TextEditor): void {
    const key = editor.document.uri.toString();
    const mySession = (this.sessions.get(key) ?? 0) + 1;
    this.sessions.set(key, mySession);

    const elapsed = Date.now() - (this.startedAt.get(key) ?? 0);
    const remaining = MIN_VISIBLE_MS - elapsed;

    if (remaining > 0) {
      setTimeout(() => {
        if (this.sessions.get(key) === mySession) editor.setDecorations(this.decorationType, []);
      }, remaining);
    } else {
      editor.setDecorations(this.decorationType, []);
    }
  }

  dispose(): void {
    this.sessions.clear();
    this.decorationType.dispose();
  }

  /** Acha o bloco de statements que envolve a região, e monta os passos a partir dos filhos dele. */
  private buildSteps(tree: Parser.Tree, startLine: number, endLine: number): vscode.Range[] {
    const target = tree.rootNode.descendantForPosition(
      { row: startLine, column: 0 },
      { row: endLine, column: 0 }
    );
    if (!target) return [];

    let block: Parser.SyntaxNode = target;
    while (block.parent && block.type !== 'statement_block' && block.type !== 'program') {
      block = block.parent;
    }

    const steps: vscode.Range[] = [];
    for (const child of block.namedChildren) {
      if (child.endPosition.row < startLine || child.startPosition.row > endLine) continue;
      steps.push(...this.stepsForStatement(child));
    }
    return steps;
  }

  private stepsForStatement(node: Parser.SyntaxNode): vscode.Range[] {
    const steps: vscode.Range[] = [this.toRange(node)];

    if (node.type === 'if_statement') {
      const consequence = node.childForFieldName('consequence');
      if (consequence) steps.push(...this.stepsForBranch(consequence));

      const alternative = node.childForFieldName('alternative');
      if (alternative) {
        const branch = alternative.type === 'else_clause' ? alternative.namedChildren[0] : alternative;
        if (branch) steps.push(...this.stepsForBranch(branch));
      }
    }

    return steps;
  }

  /** Pinta o branch (if/else) inteiro, depois cada ponto de dentro dele. */
  private stepsForBranch(branch: Parser.SyntaxNode): vscode.Range[] {
    const steps: vscode.Range[] = [this.toRange(branch)];
    for (const child of branch.namedChildren) {
      steps.push(this.toRange(child));
    }
    return steps;
  }

  private toRange(node: Parser.SyntaxNode): vscode.Range {
    return new vscode.Range(
      node.startPosition.row,
      node.startPosition.column,
      node.endPosition.row,
      node.endPosition.column
    );
  }
}
