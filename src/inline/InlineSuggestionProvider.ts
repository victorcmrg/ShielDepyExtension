import * as vscode from 'vscode';
import { GraphManager } from '../graph/GraphManager';
import { AnthropicService } from '../services/AnthropicService';

const MIN_TRIGGER_CHARS = 2;

/**
 * Ghost text estilo Copilot: usa o InlineCompletionItemProvider nativo do VS Code,
 * que já renderiza a sugestão como texto "sombra" à frente do cursor, some ao mover
 * o cursor/clicar fora, e é aceita com Tab (ou Enter, via keybinding em package.json
 * ligada ao contexto `inlineSuggestionVisible`).
 *
 * Cada requisição é debounced e cancelável: se o usuário continuar digitando antes
 * da resposta chegar, a requisição antiga é descartada (nunca aparece uma sugestão
 * defasada em cima do texto novo).
 */
export class InlineSuggestionProvider implements vscode.InlineCompletionItemProvider {
  private lastRequestId = 0;

  constructor(
    private readonly graphManager: GraphManager,
    private readonly anthropicService: AnthropicService
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = vscode.workspace.getConfiguration('shieldepy');
    if (!config.get<boolean>('inlineSuggestions.enabled', true)) {
      return undefined;
    }

    const linePrefix = document.lineAt(position).text.slice(0, position.character);
    const isAutomatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic;
    if (isAutomatic && linePrefix.trim().length < MIN_TRIGGER_CHARS) {
      return undefined;
    }

    const requestId = ++this.lastRequestId;
    const debounceMs = config.get<number>('inlineSuggestions.debounceMs', 250);
    await this.sleep(debounceMs, token);
    if (token.isCancellationRequested || requestId !== this.lastRequestId) {
      return undefined;
    }

    const fileId = document.uri.toString();
    const subgraph = this.graphManager.getImpactSubgraph(fileId, 1);
    // Não é só "o arquivo inteiro" — acha exatamente a função/método que envolve o cursor
    // (o ambiente de coding atual de verdade) e pega só a vizinhança DELA, com assinatura,
    // pra IA ter como sugerir uma chamada compatível em vez de inventar nome ou parâmetro.
    const enclosing = this.graphManager.getEnclosingSymbol(fileId, position.line);
    const localContext = enclosing ? this.graphManager.getSymbolContext(enclosing.id) : [];

    const prefix = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
    const lastLine = document.lineAt(document.lineCount - 1);
    const suffix = document.getText(new vscode.Range(position, lastLine.range.end));

    try {
      const suggestion = await this.anthropicService.getInlineSuggestion({
        prefix,
        suffix,
        languageId: document.languageId,
        subgraph,
        enclosing,
        localContext,
      });

      if (token.isCancellationRequested || requestId !== this.lastRequestId) {
        return undefined;
      }
      if (!suggestion.trim()) {
        return undefined;
      }

      return [new vscode.InlineCompletionItem(suggestion, new vscode.Range(position, position))];
    } catch (err) {
      console.error('[ShielDepy] falha ao gerar sugestão inline:', err);
      return undefined;
    }
  }

  private sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      token.onCancellationRequested(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
