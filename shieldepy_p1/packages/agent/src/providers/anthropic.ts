import Anthropic from '@anthropic-ai/sdk';
import type { Completion, CompletionRequest, LLMProvider, ModelTier } from '../provider';

export const DEFAULT_ANTHROPIC_MODELS: Record<ModelTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  deep: 'claude-haiku-4-5-20251001',
};

/** O pedaço do SDK que usamos — permite injetar um cliente falso nos testes. */
export type MessagesClient = Pick<Anthropic, 'messages'>;

export interface AnthropicProviderOptions {
  apiKey: string;
  models?: Partial<Record<ModelTier, string>>;
  client?: MessagesClient;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  private readonly client: MessagesClient;
  private readonly models: Record<ModelTier, string>;

  constructor(options: AnthropicProviderOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.models = { ...DEFAULT_ANTHROPIC_MODELS, ...stripEmpty(options.models) };
  }

  async complete(request: CompletionRequest): Promise<string> {
    return (await this.completeWithUsage(request)).text;
  }

  async completeWithUsage(request: CompletionRequest): Promise<Completion> {
    // Sem `temperature`: os modelos atuais (Opus 5, Sonnet 5…) rejeitam o parâmetro com 400, e
    // o modelo "deep" é configurável pelo usuário. JSON é garantido pelo prompt + validação.
    const response = await this.client.messages.create(
      {
        model: this.models[request.tier],
        max_tokens: request.maxTokens,
        // system estável vira bloco com cache_control: as próximas chamadas leem o prefixo do cache
        system: request.cacheSystem ? [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }] : request.system,
        messages: request.messages,
      },
      { signal: request.signal }
    );

    if (response.stop_reason === 'refusal') {
      throw new Error('o modelo recusou a solicitação (stop_reason: refusal)');
    }
    // resposta cortada: num modelo que raciocina (Sonnet 5.5, Opus 5.5), o raciocínio também gasta o
    // max_tokens. Um JSON pela metade tem que aparecer como corte, não como "JSON inválido". Texto
    // livre (chat) cortado ainda serve, e segue como está.
    if (response.stop_reason === 'max_tokens' && request.json) {
      throw new Error(`resposta cortada no limite de ${request.maxTokens} tokens (stop_reason: max_tokens) — ${response.model}`);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const u = response.usage;
    return {
      text,
      model: response.model ?? this.models[request.tier],
      ...(u && {
        usage: {
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
          ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}),
        },
      }),
    };
  }
}

function stripEmpty<T extends object>(obj: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '')) as Partial<T>;
}
