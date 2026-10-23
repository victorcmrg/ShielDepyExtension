// Contrato ÚNICO com qualquer LLM. Trocar de IA = trocar a implementação; nada acima disto
// sabe se quem responde é Claude ou Gemini. "offline" não é um provider: é a ausência dele,
// e cada caso de uso tem sua resposta determinística.

export type ModelTier = 'fast' | 'deep';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  /** fast = latência/custo (inline, scan); deep = qualidade (chat, revisão). */
  tier: ModelTier;
  maxTokens: number;
  /** Pede resposta em JSON quando o provider suporta forçar isso. */
  json?: boolean;
  /** Cancela a requisição de verdade (item 3.3) — não só ignora a resposta depois. */
  signal?: AbortSignal;
  /**
   * O `system` é estável entre chamadas (catálogo, instruções fixas): marca para cache de prompt
   * (Anthropic). Só compensa se ele passar do mínimo cacheável do modelo; abaixo disso não faz nada
   * (sem erro e sem custo). Medido na E5: o system do Threat Modeler tem ~600 tokens e o dos
   * especialistas ~300; o mínimo é 4096 no Haiku 4.5 e 512 no Sonnet 5.5. Ou seja, hoje só o
   * Threat Modeler no Sonnet cacheia, e só entre execuções com menos de 5 min de intervalo.
   */
  cacheSystem?: boolean;
}

/** Tokens de uma chamada, como o provedor cobra. `cacheRead`/`cacheWrite` só existem na Anthropic. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** Resposta com o que ela custou: o texto, o modelo que respondeu de fato e os tokens. */
export interface Completion {
  text: string;
  model: string;
  usage?: TokenUsage;
}

export type ProviderName = 'anthropic' | 'gemini';
export type Engine = ProviderName | 'offline';

export interface LLMProvider {
  readonly name: ProviderName;
  /** Texto da resposta. Lança em erro de rede/API/recusa — quem chama decide o fallback. */
  complete(request: CompletionRequest): Promise<string>;
  /** O mesmo, com os tokens usados (para o custo de cada execução). Opcional: ver `completeDetailed`. */
  completeWithUsage?(request: CompletionRequest): Promise<Completion>;
}

/** `completeWithUsage` quando o provider tem; senão só o texto, sem tokens (o custo sai como desconhecido). */
export async function completeDetailed(provider: LLMProvider, request: CompletionRequest): Promise<Completion> {
  if (provider.completeWithUsage) return provider.completeWithUsage(request);
  return { text: await provider.complete(request), model: provider.name };
}

export type Logger = (message: string) => void;

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError');
}
