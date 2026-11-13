// IA local pelo Ollama (decisão 0037): fetch nativo na API do próprio Ollama, sem chave e sem custo.
// Serve para o modelo que a equipe de IA treinou (o GGUF do Llama-3.2-1B), mas aceita qualquer modelo
// instalado. A saída passa pela mesma validação do motor que a de qualquer outra IA (0001).
import type { Completion, CompletionRequest, LLMProvider } from '../provider';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'shieldepy';

export interface OllamaProviderOptions {
  /** O nome do modelo no Ollama (`ollama list`). */
  model?: string;
  /** Onde o Ollama escuta. Aceita o formato do `OLLAMA_HOST` (sem o `http://`). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaProviderOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  get model(): string {
    return this.options.model?.trim() || DEFAULT_OLLAMA_MODEL;
  }

  get baseUrl(): string {
    return normalizeOllamaUrl(this.options.baseUrl);
  }

  async complete(request: CompletionRequest): Promise<string> {
    return (await this.completeWithUsage(request)).text;
  }

  async completeWithUsage(request: CompletionRequest): Promise<Completion> {
    const body = JSON.stringify({
      model: this.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      stream: false,
      ...(request.json ? { format: 'json' } : {}),
      options: { num_predict: request.maxTokens },
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: request.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new Error(`Ollama fora do ar em ${this.baseUrl} (o app do Ollama está aberto?)`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const hint = res.status === 404 ? ` (o modelo "${this.model}" está instalado? veja "ollama list")` : '';
      throw new Error(`Ollama respondeu ${res.status}${hint}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    if (data.error) throw new Error(`Ollama: ${data.error.slice(0, 300)}`);
    const text = data.message?.content ?? '';
    if (!text.trim()) throw new Error('resposta do Ollama sem texto');
    return {
      text,
      // o prefixo diz ao CostMeter que é local (custo zero)
      model: `ollama:${data.model ?? this.model}`,
      // local: os tokens existem, o custo é zero
      ...(data.prompt_eval_count !== undefined || data.eval_count !== undefined
        ? { usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 } }
        : {}),
    };
  }
}

/** `OLLAMA_HOST` pode vir como `127.0.0.1:11434`, `0.0.0.0` ou URL inteira; sem nada, o padrão local. */
export function normalizeOllamaUrl(value?: string): string {
  const raw = value?.trim();
  if (!raw) return DEFAULT_OLLAMA_URL;
  let url = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  url = url.replace(/\/+$/, '');
  // 0.0.0.0 é para o servidor escutar em tudo; para chamar, é o próprio computador
  url = url.replace('://0.0.0.0', '://127.0.0.1');
  if (!/:\d+$/.test(url.replace(/^https?:\/\//i, ''))) url += ':11434';
  return url;
}
