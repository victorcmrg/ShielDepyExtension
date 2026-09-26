// Cliente da API do Google Gemini via fetch nativo (sem SDK), com retry nos status transitórios.
import type { CompletionRequest, LLMProvider, Logger } from '../provider';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Status transitórios do lado do Google — vale reesperar e tentar de novo. */
const TRANSIENT = new Set([429, 500, 503]);

export interface GeminiProviderOptions {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  /** Espera (ms) entre tentativas; o tamanho define o nº de retentativas. */
  backoffMs?: number[];
  log?: Logger;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly backoffMs: number[];

  constructor(private readonly options: GeminiProviderOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.backoffMs = options.backoffMs ?? [800, 2000, 4000, 8000];
  }

  async complete(request: CompletionRequest): Promise<string> {
    const model = this.options.model || DEFAULT_GEMINI_MODEL;
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        ...(request.json ? { responseMimeType: 'application/json' } : {}),
      },
    });

    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body,
        signal: request.signal,
      });

      if (res.ok) return extractText((await res.json()) as GeminiResponse);

      const wait = this.backoffMs[attempt];
      if (TRANSIENT.has(res.status) && wait !== undefined) {
        this.options.log?.(`[gemini] ${res.status} (congestionado) — nova tentativa em ${wait}ms`);
        await sleep(wait, request.signal);
        continue;
      }
      const detail = await res.text().catch(() => '');
      throw new Error(`Gemini respondeu ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

/** Modelos "pensantes" mandam partes de raciocínio (thought:true) antes da resposta — só a resposta importa. */
function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => p.thought !== true && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
  if (!text) throw new Error('resposta do Gemini sem texto');
  return text;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
