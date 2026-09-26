import type { LLMProvider, Logger, ModelTier } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';

export interface ProviderConfig {
  anthropicKey?: string;
  anthropicModels?: Partial<Record<ModelTier, string>>;
  geminiKey?: string;
  geminiModel?: string;
  log?: Logger;
}

/**
 * Escolhe a IA pelas chaves disponíveis: Anthropic, senão Gemini, senão nenhuma
 * (`undefined` = modo offline — cada caso de uso cai na sua resposta determinística).
 */
export function selectProvider(config: ProviderConfig): LLMProvider | undefined {
  if (config.anthropicKey?.trim()) {
    return new AnthropicProvider({ apiKey: config.anthropicKey.trim(), models: config.anthropicModels });
  }
  if (config.geminiKey?.trim()) {
    return new GeminiProvider({ apiKey: config.geminiKey.trim(), model: config.geminiModel, log: config.log });
  }
  return undefined;
}

/** Mesma escolha, lendo as variáveis de ambiente (CLI e web). */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env, log?: Logger): LLMProvider | undefined {
  return selectProvider({
    anthropicKey: env.ANTHROPIC_API_KEY,
    anthropicModels: { fast: env.SHIELDEPY_FAST_MODEL, deep: env.SHIELDEPY_DEEP_MODEL },
    geminiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    log,
  });
}
