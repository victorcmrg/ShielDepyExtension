import * as vscode from 'vscode';
import { languageName } from '@shieldepy/agent';

export type AiProviderSetting = 'auto' | 'anthropic' | 'gemini' | 'offline';
export type AnalysisTrigger = 'onType' | 'onSave';
export type MinSeverity = 'info' | 'warning' | 'error';

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
  /** Endereço do portal da conta. Vazio (o padrão) = sem portal: modo local, sem login. */
  webBaseUrl(): string {
    return this.raw.get<string>('webBaseUrl', '').trim();
  },
  hasPortal(): boolean {
    return this.webBaseUrl() !== '';
  },
  /** Quando a análise automática roda: a cada pausa na digitação, ou só ao salvar/abrir. */
  analysisTrigger(): AnalysisTrigger {
    return this.raw.get<AnalysisTrigger>('backgroundAnalysis.trigger', 'onType');
  },
  /** Severidade mínima exibida (Problems, marca-texto, painel). Abaixo disso, some. */
  minSeverity(): MinSeverity {
    return this.raw.get<MinSeverity>('display.minSeverity', 'info');
  },
  /** Globs extras ignorados pela análise, além de node_modules/dist/etc. */
  excludeGlobs(): string[] {
    return this.raw.get<string[]>('analysis.exclude', []).map((g) => g.trim()).filter(Boolean);
  },
  /** Teto de arquivos indexados no mapa do workspace. */
  maxIndexedFiles(): number {
    return Math.max(10, this.raw.get<number>('index.maxFiles', 3000));
  },
  statusBarEnabled(): boolean {
    return this.raw.get<boolean>('statusBar.enabled', true);
  },
  update(key: string, value: unknown): Thenable<void> {
    return this.raw.update(key, value, vscode.ConfigurationTarget.Global);
  },
};
