import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  attackSurface,
  buildSystemGraph,
  buildTopology,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  silentHost,
  type AttackSurface,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import type { LLMProvider } from '../../src/index';
import { baselineHypotheses, modelThreats, parseThreatModel, runChaosPipeline } from '../../src/chaos';

const EXAMPLES = fileURLToPath(new URL('../../../../examples/', import.meta.url));

async function surfaceOf(example: string): Promise<AttackSurface> {
  const dir = path.join(EXAMPLES, example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  return attackSurface(buildTopology(graph, buildSystemGraph(graph, [], dir), dir));
}

/** Provider falso que responde `text` e registra o pedido (com tokens, como a Anthropic). */
function fakeProvider(text: string | (() => never)) {
  const calls: Array<Parameters<LLMProvider['complete']>[0]> = [];
  const provider: LLMProvider = {
    name: 'anthropic',
    complete: async () => {
      throw new Error('deveria usar completeWithUsage');
    },
    completeWithUsage: vi.fn(async (req) => {
      calls.push(req);
      if (typeof text === 'function') text();
      return { text: text as string, model: 'claude-opus-5-5', usage: { inputTokens: 3000, outputTokens: 800 } };
    }),
  };
  return { provider, calls };
}

let vulnerable: AttackSurface;
let fixed: AttackSurface;

beforeAll(async () => {
  [vulnerable, fixed] = await Promise.all([surfaceOf('checkout-express'), surfaceOf('checkout-express-fixed')]);
});

describe('E3/3c — lista-base do motor (offline)', () => {
  it('checkout-express: corrida no estoque e falhas do Stripe; a rota só de leitura não gera nada', () => {
    const ids = baselineHypotheses(vulnerable).map((h) => `${h.priority} ${h.id}${h.testable ? '' : ' (sem teste)'}`);
    expect(ids).toEqual([
      '1 POST /checkout__race_condition__stock',
      '1 POST /checkout__timeout__api.stripe.com',
      '2 POST /checkout__partial_failure_after_external_call__orders (sem teste)',
      '2 POST /checkout__partial_failure_after_external_call__stock (sem teste)',
      '3 POST /checkout__http_5xx_intermittent__api.stripe.com',
      '3 POST /checkout__malformed_response__api.stripe.com',
    ]);
    expect(baselineHypotheses(vulnerable).every((h) => h.routeId !== 'GET /orders/:id')).toBe(true);
  });

  it('checkout-express-fixed: com timeout no Stripe, não há hipótese de timeout; a corrida continua (para provar a correção)', () => {
    const ids = baselineHypotheses(fixed).map((h) => h.id);
    expect(ids).not.toContain('POST /checkout__timeout__api.stripe.com');
    expect(ids).toContain('POST /checkout__race_condition__stock');
    expect(ids).toContain('POST /checkout__http_5xx_intermittent__api.stripe.com');
  });
});

describe('E3/3c — validação do que a IA propõe', () => {
  it('descarta rota, falha e alvo inventados; aceita alvo omitido quando só há um', () => {
    const text = JSON.stringify({
      summary: 'Checkout com corrida.',
      hypotheses: [
        { routeId: 'POST /checkout', failure: 'race_condition', target: 'stock', priority: 1, rationale: 'lê e grava stock com o Stripe no meio' },
        { routeId: 'POST /pagar', failure: 'timeout', target: 'api.stripe.com' },
        { routeId: 'POST /checkout', failure: 'sql_injection', target: 'stock' },
        { routeId: 'POST /checkout', failure: 'timeout', target: 'api.paypal.com' },
        { routeId: 'GET /orders/:id', failure: 'race_condition', target: 'orders' },
        { routeId: 'POST /checkout', failure: 'retry_storm', priority: 3 },
        { routeId: 'POST /checkout', failure: 'race_condition', target: 'stock' },
        'lixo',
      ],
    });
    const r = parseThreatModel(text, vulnerable);
    expect(r.hypotheses.map((h) => `${h.id} ${h.source}`)).toEqual([
      'POST /checkout__race_condition__stock ia',
      'POST /checkout__retry_storm__api.stripe.com ia',
    ]);
    expect(r.rejected.map((x) => x.reason)).toEqual([
      'rota fora da superfície: POST /pagar',
      'falha fora do catálogo: sql_injection',
      'alvo api.paypal.com não existe em POST /checkout para timeout (válidos: api.stripe.com)',
      'race_condition não é habilitada pelas tags de GET /orders/:id',
      'repetida: POST /checkout__race_condition__stock',
      'rota fora da superfície: undefined',
    ]);
    expect(r.summary).toBe('Checkout com corrida.');
  });

  it('resposta que não é JSON ou sem "hypotheses" lança (quem chama cai no offline)', () => {
    expect(() => parseThreatModel('não sei', vulnerable)).toThrow(/não é JSON/);
    expect(() => parseThreatModel('{"riscos": []}', vulnerable)).toThrow(/hypotheses/);
  });
});

describe('E3/3c — Threat Modeler', () => {
  it('a IA explica e prioriza, mas não tira nada da lista-base; o pedido vai sem código e com o system em cache', async () => {
    const { provider, calls } = fakeProvider(
      '```json\n' +
        JSON.stringify({
          summary: 'O checkout vende o mesmo item duas vezes.',
          hypotheses: [
            { routeId: 'POST /checkout', failure: 'malformed_response', target: 'api.stripe.com', priority: 1, rationale: 'corpo inválido do Stripe vira 500' },
            { routeId: 'POST /checkout', failure: 'retry_storm', target: 'api.stripe.com', priority: 3, rationale: 'sem retry hoje' },
            { routeId: 'POST /inexistente', failure: 'timeout' },
          ],
        }) +
        '\n```'
    );
    const model = await modelThreats(vulnerable, { provider });

    const malformed = model.hypotheses.find((h) => h.failure === 'malformed_response')!;
    expect(malformed).toMatchObject({ priority: 1, source: 'motor+ia', rationale: 'corpo inválido do Stripe vira 500' });
    expect(model.hypotheses.find((h) => h.failure === 'retry_storm')).toMatchObject({ source: 'ia', testable: false });
    // a IA não mencionou a corrida: ela continua, com o texto do motor
    expect(model.hypotheses.find((h) => h.failure === 'race_condition')).toMatchObject({ source: 'motor' });
    expect(model.hypotheses).toHaveLength(baselineHypotheses(vulnerable).length + 1);
    expect(model).toMatchObject({ engine: 'anthropic', summary: 'O checkout vende o mesmo item duas vezes.', rejected: [{ index: 2 }] });
    expect(model.completion?.usage).toEqual({ inputTokens: 3000, outputTokens: 800 });

    const req = calls[0]!;
    expect(req).toMatchObject({ tier: 'deep', json: true, cacheSystem: true });
    expect(req.system).toContain('race_condition');
    const sent = req.messages[0]!.content;
    expect(sent).toContain('POST /checkout');
    expect(sent).toContain(vulnerable.topologyHash);
    for (const code of ['this.db.query', 'await ', 'class ', 'import ']) expect(sent).not.toContain(code);
  });

  it('resposta inválida ou IA fora do ar: fica a lista-base, com o motivo registrado', async () => {
    const bad = await modelThreats(vulnerable, { provider: fakeProvider('desculpe, não consigo').provider });
    expect(bad).toMatchObject({ engine: 'offline', error: 'resposta da IA não é JSON válido' });
    expect(bad.hypotheses).toEqual(baselineHypotheses(vulnerable));
    expect(bad.completion).toBeDefined(); // a chamada custou, mesmo descartada

    const down = await modelThreats(vulnerable, { provider: fakeProvider(() => { throw new Error('529 overloaded'); }).provider });
    expect(down).toMatchObject({ engine: 'offline', error: '529 overloaded' });
    expect(down.hypotheses).toEqual(baselineHypotheses(vulnerable));
  });

  it('sem provider: offline, sem chamada', async () => {
    expect(await modelThreats(vulnerable)).toEqual({ hypotheses: baselineHypotheses(vulnerable), rejected: [], engine: 'offline' });
  });
});

describe('E3/3c — grafo LangGraph', () => {
  it('offline e com IA: o estado final traz hipóteses, motor que as escreveu, custo e erros', async () => {
    const offline = await runChaosPipeline(vulnerable);
    expect(offline).toMatchObject({ engine: 'offline', completions: [], errors: [] });
    expect(offline.hypotheses.length).toBe(6);

    const { provider } = fakeProvider(JSON.stringify({ hypotheses: [] }));
    const ai = await runChaosPipeline(vulnerable, { provider });
    expect(ai.engine).toBe('anthropic');
    expect(ai.completions).toHaveLength(1);

    const broken = await runChaosPipeline(vulnerable, { provider: fakeProvider('{').provider });
    expect(broken.errors).toEqual(['threat_modeler: resposta da IA não é JSON válido']);
  });
});
