import * as vscode from 'vscode';
import { inlineSuggestion, isAbortError } from '@shieldepy/agent';
import { toFileId } from '@shieldepy/core';
import { config } from '../config';
import type { AiService } from '../services/AiService';
import type { WorkspaceModel } from '../workspace/WorkspaceModel';

const MIN_TRIGGER_CHARS = 2;

/**
 * Ghost text estilo Copilot via InlineCompletionItemProvider nativo. Cada requisição é debounced
 * e cancelável DE VERDADE: o CancellationToken do VS Code aborta a chamada HTTP (item 3.3).
 * Registrado só pra linguagens de código em arquivos reais (item 3.2 — antes era `**`, até `.env`).
 */
export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
  private lastRequestId = 0;

  constructor(
    private readonly model: WorkspaceModel,
    private readonly ai: AiService,
    private readonly log: (message: string) => void
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!config.inlineEnabled()) return undefined;

    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && linePrefix.trim().length < MIN_TRIGGER_CHARS) {
      return undefined;
    }

    const requestId = ++this.lastRequestId;
    await sleep(config.inlineDebounceMs(), token);
    if (token.isCancellationRequested || requestId !== this.lastRequestId) return undefined;

    const provider = await this.ai.provider();
    if (!provider) return undefined;

    const fileId = toFileId(document.uri.fsPath);
    // A função/método que envolve o cursor e SÓ a vizinhança dela, com assinatura — é o que deixa
    // a IA sugerir uma chamada compatível em vez de inventar nome ou parâmetro.
    const enclosing = this.model.graph.getEnclosingSymbol(fileId, position.line);
    const localContext = enclosing ? this.model.graph.getSymbolContext(enclosing.id) : [];
    const lastLine = document.lineAt(document.lineCount - 1);

    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
      const suggestion = await this.ai.run(() =>
        inlineSuggestion(provider, {
          prefix: document.getText(new vscode.Range(new vscode.Position(0, 0), position)),
          suffix: document.getText(new vscode.Range(position, lastLine.range.end)),
          languageId: document.languageId,
          subgraph: this.model.graph.getImpactSubgraph(fileId, 1),
          enclosing,
          localContext,
          signal: controller.signal,
        })
      );
      if (token.isCancellationRequested || requestId !== this.lastRequestId || !suggestion.trim()) return undefined;
      return [new vscode.InlineCompletionItem(suggestion, new vscode.Range(position, position))];
    } catch (err) {
      if (!isAbortError(err)) this.log(`[inline] falha ao gerar sugestão: ${err}`);
      return undefined;
    } finally {
      subscription.dispose();
    }
  }
}

function sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
