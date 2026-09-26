import { describe, expect, it, vi } from 'vitest';
import {
  AnthropicProvider,
  GeminiProvider,
  parseFixedFile,
  parseRiskFindings,
  scanForRisks,
  selectProvider,
  trimHistory,
  type ChatMessage,
  type LLMProvider,
} from '../src/index';

const req = { system: 'sys', messages: [{ role: 'user' as const, content: 'oi' }], tier: 'fast' as const, maxTokens: 10 };

describe('AnthropicProvider', () => {
  function fakeClient(response: object) {
    const create = vi.fn(async () => response);
    return { create, client: { messages: { create } } as any };
  }

  it('manda modelo do tier, repassa o AbortSignal e NÃO manda temperature', async () => {
    const { create, client } = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
    const signal = new AbortController().signal;
    const p = new AnthropicProvider({ apiKey: 'k', client, models: { deep: 'claude-sonnet-5', fast: '' } });

    expect(await p.complete({ ...req, signal })).toBe('a\nb');
    const [params, options] = create.mock.calls[0] as unknown as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params.model).toBe('claude-haiku-4-5-20251001'); // fast vazio = padrão
    expect(params).not.toHaveProperty('temperature');
    expect(options.signal).toBe(signal);

    await p.complete({ ...req, tier: 'deep' });
    expect((create.mock.calls[1] as unknown as [Record<string, unknown>])[0].model).toBe('claude-sonnet-5');
  });

  it('recusa do modelo vira erro (quem chama cai no fallback)', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', content: [] });
    await expect(new AnthropicProvider({ apiKey: 'k', client }).complete(req)).rejects.toThrow(/refusal/);
  });
});

describe('GeminiProvider', () => {
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pensando', thought: true }, { text }] } }] }));

  it('mapeia papéis, pede JSON e ignora partes de raciocínio', async () => {
    const fetchMock = vi.fn(async () => ok('resposta'));
    const p = new GeminiProvider({ apiKey: 'k', fetch: fetchMock as any, backoffMs: [] });
    const history: ChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ];

    expect(await p.complete({ ...req, messages: history, json: true })).toBe('resposta');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model']);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('503 → espera e tenta de novo; 400 → erro na hora', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('ocupado', { status: 503 })).mockResolvedValueOnce(ok('foi'));
    expect(await new GeminiProvider({ apiKey: 'k', fetch: fetchMock, backoffMs: [1] }).complete(req)).toBe('foi');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const bad = vi.fn(async () => new Response('ruim', { status: 400 }));
    await expect(new GeminiProvider({ apiKey: 'k', fetch: bad as any, backoffMs: [1, 1] }).complete(req)).rejects.toThrow(/400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });
});

describe('selectProvider', () => {
  it('Anthropic > Gemini > offline (undefined); chave em branco não conta', () => {
    expect(selectProvider({ anthropicKey: 'a', geminiKey: 'g' })?.name).toBe('anthropic');
    expect(selectProvider({ anthropicKey: '  ', geminiKey: 'g' })?.name).toBe('gemini');
    expect(selectProvider({})).toBeUndefined();
  });
});

describe('scanForRisks', () => {
  const provider = (reply: string): LLMProvider & { last?: string } => ({
    name: 'gemini',
    async complete(r) {
      (this as { last?: string }).last = r.messages[0]!.content;
      return reply;
    },
  });

  it('aceita cercas, descarta itens fora do formato e inclui os fatos provados no pedido', async () => {
    const p = provider('```json\n[{"startLine":1,"endLine":2,"severity":"warning","message":"m","impact":""},{"startLine":"x"},{"startLine":5,"endLine":1,"severity":"info","message":"invertido"}]\n```');
    const findings = await scanForRisks(p, {
      text: 'a\nb\nc',
      subgraph: { nodes: [], edges: [] },
      language: 'português',
      provenFacts: ['ciclo a → b → a'],
    });
    expect(findings).toEqual([{ startLine: 1, endLine: 2, severity: 'warning', message: 'm', impact: undefined }]);
    expect(p.last).toContain('FATOS PROVADOS');
    expect(p.last).toContain('1: b');
  });

  it('resposta que não é array → nenhum achado', () => {
    expect(parseRiskFindings('{"a":1}')).toEqual([]);
    expect(parseRiskFindings('')).toEqual([]);
  });
});

describe('utilitários', () => {
  it('trimHistory mantém as mais recentes e começa por mensagem do usuário', () => {
    const h: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` }));
    const t = trimHistory(h, 4);
    expect(t.map((m) => m.content)).toEqual(['m6', 'm7', 'm8', 'm9']);
    expect(trimHistory(h, 3)[0]!.role).toBe('user');
    expect(trimHistory([{ role: 'user', content: 'x'.repeat(100) }, { role: 'assistant', content: 'y'.repeat(100) }, { role: 'user', content: 'z' }], 10, 150).map((m) => m.content)).toEqual(['z']);
  });

  it('parseFixedFile extrai caminho, conteúdo e explicação', () => {
    const reply = 'Corrigi o ciclo.\nFIXED_FILE: src/a.ts\n```ts\nexport const a = 1;\n```';
    expect(parseFixedFile(reply)).toEqual({ path: 'src/a.ts', content: 'export const a = 1;', explanation: 'Corrigi o ciclo.' });
    expect(parseFixedFile('sem proposta')).toBeUndefined();
  });
});
