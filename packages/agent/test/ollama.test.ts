import { describe, expect, it, vi } from 'vitest';
import { CostMeter, OllamaProvider, completeDetailed, normalizeOllamaUrl, providerFromEnv, selectProvider } from '../src/index';

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'oi' }], tier: 'fast' as const, maxTokens: 64 };

function okFetch(body: object) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
}

describe('OllamaProvider (0037)', () => {
  it('chama /api/chat com o system, sem stream, o limite de tokens e o JSON quando pedido', async () => {
    const fetchMock = okFetch({ model: 'shieldepy:latest', message: { content: '{"a":1}' }, prompt_eval_count: 12, eval_count: 5 });
    const signal = new AbortController().signal;
    const p = new OllamaProvider({ fetch: fetchMock as any });

    const c = await p.completeWithUsage({ ...req, json: true, signal });
    expect(c).toEqual({ text: '{"a":1}', model: 'ollama:shieldepy:latest', usage: { inputTokens: 12, outputTokens: 5 } });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(init.signal).toBe(signal);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: 'shieldepy',
      messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'oi' }],
      stream: false,
      format: 'json',
      options: { num_predict: 64 },
    });
  });

  it('custo zero no CostMeter: é local', async () => {
    const meter = new CostMeter();
    meter.add(await completeDetailed(new OllamaProvider({ fetch: okFetch({ model: 'm', message: { content: 'x' }, prompt_eval_count: 1000, eval_count: 1000 }) as any }), req));
    expect(meter.report()).toMatchObject({ calls: 1, usd: 0, unpriced: [] });
  });

  it('404 diz para conferir o modelo; fora do ar diz para abrir o Ollama; resposta vazia é erro', async () => {
    const notFound = vi.fn(async () => new Response('{"error":"model not found"}', { status: 404 }));
    await expect(new OllamaProvider({ model: 'x', fetch: notFound as any }).complete(req)).rejects.toThrow(/"x" está instalado/);

    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(new OllamaProvider({ fetch: down as any }).complete(req)).rejects.toThrow(/fora do ar/);

    await expect(new OllamaProvider({ fetch: okFetch({ message: { content: '  ' } }) as any }).complete(req)).rejects.toThrow(/sem texto/);
  });

  it('o cancelamento continua sendo AbortError (quem chama não confunde com Ollama fora do ar)', async () => {
    const aborted = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    await expect(new OllamaProvider({ fetch: aborted as any }).complete(req)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('o endereço aceita o formato do OLLAMA_HOST', () => {
    expect(normalizeOllamaUrl(undefined)).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaUrl('0.0.0.0')).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaUrl('127.0.0.1:9999')).toBe('http://127.0.0.1:9999');
    expect(normalizeOllamaUrl('https://gpu.local:8080/')).toBe('https://gpu.local:8080');
  });
});

describe('escolha do Ollama', () => {
  it('só quando escolhido: ganha das chaves; no automático, nada muda', () => {
    expect(selectProvider({ anthropicKey: 'k', ollama: { model: 'meu' } })?.name).toBe('ollama');
    expect(selectProvider({ anthropicKey: 'k' })?.name).toBe('anthropic');
    expect(selectProvider({})).toBeUndefined();
  });

  it('pela CLI: SHIELDEPY_AI=ollama, com OLLAMA_MODEL e OLLAMA_HOST', () => {
    const p = providerFromEnv({ SHIELDEPY_AI: 'ollama', OLLAMA_MODEL: 'shieldepy-teste', OLLAMA_HOST: '127.0.0.1:1234', ANTHROPIC_API_KEY: 'k' });
    expect(p).toBeInstanceOf(OllamaProvider);
    expect((p as OllamaProvider).model).toBe('shieldepy-teste');
    expect((p as OllamaProvider).baseUrl).toBe('http://127.0.0.1:1234');
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'k' })?.name).toBe('anthropic');
  });
});
