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
}

export type ProviderName = 'anthropic' | 'gemini';
export type Engine = ProviderName | 'offline';

export interface LLMProvider {
  readonly name: ProviderName;
  /** Texto da resposta. Lança em erro de rede/API/recusa — quem chama decide o fallback. */
  complete(request: CompletionRequest): Promise<string>;
}

export type Logger = (message: string) => void;

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError');
}
