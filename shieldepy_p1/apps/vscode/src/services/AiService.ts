import * as vscode from 'vscode';
import { selectProvider, type Engine, type LLMProvider } from '@shieldepy/agent';
import { config } from '../config';
import { SECRET_ANTHROPIC, SECRET_GEMINI } from '../constants';

/** No máximo N chamadas de IA ao mesmo tempo (background + chat + varredura) — item 3.7. */
class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/**
 * Qual IA está ativa, a partir das settings + chaves no Secret Storage. `undefined` = offline
 * (nenhuma chave, ou `aiProvider: offline`): o que é determinístico continua funcionando.
 */
export class AiService implements vscode.Disposable {
  private cached: { provider: LLMProvider | undefined } | undefined;
  private readonly limiter = new Limiter(2);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly log: (message: string) => void
  ) {
    this.disposables.push(
      secrets.onDidChange((e) => {
        if (e.key === SECRET_ANTHROPIC || e.key === SECRET_GEMINI) this.invalidate();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (['aiProvider', 'fastModel', 'deepModel', 'geminiModel'].some((k) => e.affectsConfiguration(`shieldepy.${k}`))) this.invalidate();
      }),
      this.changeEmitter
    );
  }

  async provider(): Promise<LLMProvider | undefined> {
    if (this.cached) return this.cached.provider;

    const choice = config.aiProvider();
    const models = config.models();
    const anthropicKey = (await this.secrets.get(SECRET_ANTHROPIC)) || process.env.ANTHROPIC_API_KEY;
    const geminiKey = (await this.secrets.get(SECRET_GEMINI)) || process.env.GEMINI_API_KEY;

    const provider =
      choice === 'offline'
        ? undefined
        : selectProvider({
            anthropicKey: choice === 'gemini' ? undefined : anthropicKey,
            geminiKey: choice === 'anthropic' ? undefined : geminiKey,
            anthropicModels: { fast: models.fast, deep: models.deep },
            geminiModel: models.gemini,
            log: this.log,
          });

    this.cached = { provider };
    this.log(`[AiService] IA ativa: ${provider?.name ?? 'offline'}`);
    return provider;
  }

  async engine(): Promise<Engine> {
    return (await this.provider())?.name ?? 'offline';
  }

  /** Executa uma chamada de IA respeitando o limite de concorrência. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter.run(fn);
  }

  async setKey(which: 'anthropic' | 'gemini', key: string): Promise<void> {
    await this.secrets.store(which === 'anthropic' ? SECRET_ANTHROPIC : SECRET_GEMINI, key);
  }

  private invalidate(): void {
    this.cached = undefined;
    this.changeEmitter.fire();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
