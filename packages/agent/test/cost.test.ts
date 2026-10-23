import { describe, expect, it, vi } from 'vitest';
import { AnthropicProvider, completeDetailed, CostMeter, costUsd, GeminiProvider, priceOf, type LLMProvider } from '../src/index';

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'oi' }], tier: 'deep' as const, maxTokens: 10 };

describe('E3/3b — tokens de cada chamada', () => {
  it('Anthropic: devolve o modelo e os tokens (com cache), e marca o system para cache quando pedido', async () => {
    const create = vi.fn(async () => ({
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
    }));
    const p = new AnthropicProvider({ apiKey: 'k', client: { messages: { create } } as any, models: { deep: 'claude-opus-5-5' } });

    expect(await p.completeWithUsage({ ...req, cacheSystem: true })).toEqual({
      text: 'ok',
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 4000 },
    });
    const params = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(params.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }]);

    await p.complete(req);
    expect((create.mock.calls[1] as unknown as [Record<string, unknown>])[0].system).toBe('sys');
  });

  it('Gemini: tokens do usageMetadata, com o raciocínio contado como saída', async () => {
    const body = {
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
      modelVersion: 'gemini-3.6-flash',
    };
    const p = new GeminiProvider({ apiKey: 'k', fetch: (async () => new Response(JSON.stringify(body))) as any, backoffMs: [] });
    expect(await p.completeWithUsage(req)).toEqual({ text: 'ok', model: 'gemini-3.6-flash', usage: { inputTokens: 100, outputTokens: 50 } });
  });

  it('provider sem completeWithUsage (ex.: falso de teste) ainda funciona, sem tokens', async () => {
    const fake: LLMProvider = { name: 'anthropic', complete: async () => 'texto' };
    expect(await completeDetailed(fake, req)).toEqual({ text: 'texto', model: 'anthropic' });
  });
});

describe('E3/3b — custo', () => {
  it('preço pelo id, inclusive com data', () => {
    expect(priceOf('claude-opus-5-5')).toEqual({ input: 4, output: 20, cacheRead: 0.2 });
    expect(priceOf('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5, cacheRead: 0.1 });
    expect(priceOf('gemini-3.6-flash')).toBeUndefined();
    expect(priceOf('claude-opus-5')).toBeUndefined(); // não confundir com o 5.5
  });

  it('entrada, saída, leitura de cache e escrita de cache (1,25× a entrada)', () => {
    // 1M de cada no Opus 5.5: 4 + 20 + 0,20 + 5 = 29,20
    const m = 1_000_000;
    expect(costUsd({ inputTokens: m, outputTokens: m, cacheReadTokens: m, cacheWriteTokens: m }, 'claude-opus-5-5')).toBeCloseTo(29.2, 6);
    expect(costUsd({ inputTokens: 8000, outputTokens: 6000 }, 'claude-sonnet-5-5')).toBeCloseTo(0.076, 6);
    expect(costUsd({ inputTokens: 1, outputTokens: 1 }, 'modelo-desconhecido')).toBeUndefined();
  });

  it('CostMeter soma a execução e separa o que não tem preço nem tokens', () => {
    const meter = new CostMeter();
    meter.add({ text: '', model: 'claude-opus-5-5', usage: { inputTokens: 10_000, outputTokens: 2_000 } });
    meter.add({ text: '', model: 'claude-haiku-4-5', usage: { inputTokens: 5_000, outputTokens: 1_000, cacheReadTokens: 20_000 } });
    meter.add({ text: '', model: 'gemini-3.6-flash', usage: { inputTokens: 7, outputTokens: 3 } });
    meter.add({ text: '', model: 'anthropic' });
    const r = meter.report();
    expect(r).toMatchObject({ calls: 4, inputTokens: 15_007, outputTokens: 3_003, cacheReadTokens: 20_000, unpriced: ['gemini-3.6-flash'], withoutUsage: 1 });
    // Opus: 0,04 + 0,04 = 0,08 · Haiku: 0,005 + 0,005 + 0,002 = 0,012
    expect(r.usd).toBeCloseTo(0.092, 6);
  });
});
