import * as vscode from 'vscode';
import { selectProvider, type Engine, type LLMProvider } from '@shieldepy/agent';
import { config } from '../config';
import { SECRET_ANTHROPIC, SECRET_GEMINI } from '../constants';
import type { AuthService } from './AuthService';

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
    private readonly log: (message: string) => void,
    private readonly auth: AuthService
  ) {
    this.disposables.push(
      secrets.onDidChange((e) => {
        if (e.key === SECRET_ANTHROPIC || e.key === SECRET_GEMINI) this.invalidate();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (['aiProvider', 'fastModel', 'deepModel', 'geminiModel'].some((k) => e.affectsConfiguration(`shieldepy.${k}`))) this.invalidate();
      }),
      auth.onDidChangeAuth(() => this.invalidate()),
      this.changeEmitter
    );
  }

  async provider(): Promise<LLMProvider | undefined> {
    // Checado em TODA chamada (não só quando `cached` está vazio) — hasAiAccess() já
    // tem cache curto próprio (AuthService), então isso não vira uma chamada de rede a
    // cada uso; é o que garante que revogar `aiEnabled` surte efeito em segundos, mesmo
    // com o provider já resolvido e guardado em `this.cached`. Sem conta, decide a chave.
    if (!(await this.auth.hasAiAccess())) {
      this.log(`[AiService] IA desligada pela empresa (${this.auth.companyAiBlock()}) — modo offline.`);
      return undefined;
    }
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

  /**
   * A mesma IA que a extensão usaria, no formato de ambiente da CLI (`providerFromEnv`): o caos roda
   * o pipeline da CLI. Sem acesso à IA (empresa bloqueou, `offline`, nenhuma chave), sai sem chave.
   */
  async cliEnv(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.GEMINI_API_KEY;
    const choice = config.aiProvider();
    if (choice === 'offline' || !(await this.auth.hasAiAccess())) return env;
    const models = config.models();
    const anthropicKey = (await this.secrets.get(SECRET_ANTHROPIC)) || process.env.ANTHROPIC_API_KEY;
    const geminiKey = (await this.secrets.get(SECRET_GEMINI)) || process.env.GEMINI_API_KEY;
    if (choice !== 'gemini' && anthropicKey) Object.assign(env, { ANTHROPIC_API_KEY: anthropicKey, SHIELDEPY_FAST_MODEL: models.fast, SHIELDEPY_DEEP_MODEL: models.deep });
    if (choice !== 'anthropic' && geminiKey) Object.assign(env, { GEMINI_API_KEY: geminiKey, GEMINI_MODEL: models.gemini });
    return env;
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
