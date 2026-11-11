import type { LLMProvider, Logger, ModelTier } from './provider';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OllamaProvider } from './providers/ollama';

export interface ProviderConfig {
  anthropicKey?: string;
  anthropicModels?: Partial<Record<ModelTier, string>>;
  geminiKey?: string;
  geminiModel?: string;
  /** IA local (0037). Só vem quando o usuário escolheu o Ollama: aí ganha das chaves. */
  ollama?: { model?: string; url?: string };
  log?: Logger;
}

/**
 * Escolhe a IA: o Ollama, se foi escolhido; senão pelas chaves, Anthropic, senão Gemini, senão nenhuma
 * (`undefined` = modo offline — cada caso de uso cai na sua resposta determinística).
 */
export function selectProvider(config: ProviderConfig): LLMProvider | undefined {
  if (config.ollama) return new OllamaProvider({ model: config.ollama.model, baseUrl: config.ollama.url });
  if (config.anthropicKey?.trim()) {
    return new AnthropicProvider({ apiKey: config.anthropicKey.trim(), models: config.anthropicModels });
  }
  if (config.geminiKey?.trim()) {
    return new GeminiProvider({ apiKey: config.geminiKey.trim(), model: config.geminiModel, log: config.log });
  }
  return undefined;
}

/**
 * Mesma escolha, lendo as variáveis de ambiente (CLI e web). `SHIELDEPY_AI=ollama` liga a IA local, com
 * `OLLAMA_MODEL` (padrão `shieldepy`) e `OLLAMA_HOST` (padrão 127.0.0.1:11434), os nomes do próprio Ollama.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env, log?: Logger): LLMProvider | undefined {
  return selectProvider({
    anthropicKey: env.ANTHROPIC_API_KEY,
    anthropicModels: { fast: env.SHIELDEPY_FAST_MODEL, deep: env.SHIELDEPY_DEEP_MODEL },
    geminiKey: env.GEMINI_API_KEY,
    geminiModel: env.GEMINI_MODEL,
    ollama: env.SHIELDEPY_AI?.trim().toLowerCase() === 'ollama' ? { model: env.OLLAMA_MODEL, url: env.OLLAMA_HOST } : undefined,
    log,
  });
}
