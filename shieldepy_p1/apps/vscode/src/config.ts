import * as vscode from 'vscode';
import { languageName } from '@shieldepy/agent';

export type AiProviderSetting = 'auto' | 'anthropic' | 'gemini' | 'offline';

/** Leitura tipada das settings — um só lugar sabe os nomes e os padrões (item 5.1). */
export const config = {
  get raw(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('shieldepy');
  },
  aiProvider(): AiProviderSetting {
    return this.raw.get<AiProviderSetting>('aiProvider', 'auto');
  },
  models(): { fast: string; deep: string; gemini: string } {
    return {
      fast: this.raw.get<string>('fastModel', ''),
      deep: this.raw.get<string>('deepModel', ''),
      gemini: this.raw.get<string>('geminiModel', ''),
    };
  },
  inlineEnabled(): boolean {
    return this.raw.get<boolean>('inlineSuggestions.enabled', true);
  },
  inlineDebounceMs(): number {
    return this.raw.get<number>('inlineSuggestions.debounceMs', 250);
  },
  analysisEnabled(): boolean {
    return this.raw.get<boolean>('backgroundAnalysis.enabled', true);
  },
  idleMs(): number {
    return this.raw.get<number>('backgroundAnalysis.idleMs', 1200);
  },
  languageCode(): string {
    return this.raw.get<string>('language', 'pt-BR');
  },
  /** Nome do idioma pra colocar no prompt. */
  languageName(): string {
    return languageName(this.languageCode());
  },
  update(key: string, value: unknown): Thenable<void> {
    return this.raw.update(key, value, vscode.ConfigurationTarget.Global);
  },
};
