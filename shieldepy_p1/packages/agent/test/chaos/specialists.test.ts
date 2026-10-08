import { describe, expect, it, vi } from 'vitest';
import type { AttackSurface } from '@shieldepy/core';
import type { CompletionRequest, LLMProvider } from '../../src/index';
import { defaultSpec, LIMITS, parseSpec, runChaosPipeline, specifyTest, type Hypothesis, type NetworkSpec } from '../../src/chaos';

/** A superfície do checkout-express, como a E2 produz (só o que importa aqui). */
const surface: AttackSurface = {
  version: 1,
  topologyHash: 'abc',
  collisions: [],
  routes: [
    {
      id: 'POST /checkout',
      method: 'POST',
      path: '/checkout',
      at: 'src/routes/checkout.ts:8',
      handlers: ['validateCheckout', 'checkoutController.create'],
      operations: [
        { order: 1, kind: 'db_read', target: 'stock', via: 'pg', at: 'a:1', in: 'available', confidence: 'proven' },
        { order: 2, kind: 'api_call', target: 'api.stripe.com', via: 'fetch', timeout: 'no', at: 'b:1', in: 'charge', confidence: 'proven' },
        { order: 3, kind: 'db_write', target: 'stock', via: 'pg', at: 'a:2', in: 'decrement', confidence: 'proven' },
      ],
      tags: [
        { tag: 'external-io', targets: ['api.stripe.com'] },
        { tag: 'no-timeout', targets: ['api.stripe.com'] },
        { tag: 'read-then-write', targets: ['stock'] },
      ],
      collisions: [],
      confidence: 'proven',
    },
  ],
};

const hyp = (failure: Hypothesis['failure'], target: string, agent: Hypothesis['agent']): Hypothesis => ({
  id: `POST /checkout__${failure}__${target}`,
  routeId: 'POST /checkout',
  failure,
  agent,
  target,
  priority: 1,
  rationale: 'r',
  source: 'motor',
  testable: true,
});
const race = hyp('race_condition', 'stock', 'concurrency');
const timeout = hyp('timeout', 'api.stripe.com', 'network');
const INVARIANTS = ['stockNeverNegative', 'atMostOneOrder'];

function provider(reply: (req: CompletionRequest) => string) {
  const requests: CompletionRequest[] = [];
  const p: LLMProvider = {
    name: 'anthropic',
    complete: async () => '',
    completeWithUsage: vi.fn(async (req: CompletionRequest) => {
      requests.push(req);
      return { text: reply(req), model: 'claude-haiku-4-5', usage: { inputTokens: 500, outputTokens: 100 } };
    }),
  };
  return { p, requests };
}

describe('E3/3d — spec padrão do motor', () => {
  it('cada falha testável tem uma spec válida; os invariantes do projeto sempre entram', () => {
    expect(defaultSpec(race, INVARIANTS)).toEqual({
      kind: 'concurrency',
      hypothesisId: race.id,
      routeId: 'POST /checkout',
      parallel: 10,
      expect: [{ kind: 'noUnhandledError' }, { kind: 'stateCheck', name: 'stockNeverNegative' }, { kind: 'stateCheck', name: 'atMostOneOrder' }],
      source: 'motor',
    });
    const t = defaultSpec(timeout, []) as NetworkSpec;
    expect(t.fault).toEqual({ mode: 'delay', delayMs: 15_000 });
    expect(t.expect).toEqual([{ kind: 'respondsWithin', ms: 6_000 }]);
    expect(defaultSpec(hyp('http_5xx_intermittent', 'api.stripe.com', 'network'), [])).toMatchObject({ fault: { mode: 'status', status: 503 } });
    expect(defaultSpec(hyp('malformed_response', 'api.stripe.com', 'network'), [])).toMatchObject({ fault: { mode: 'malformed', body: 'html' } });
    expect(defaultSpec(hyp('partial_failure_after_external_call', 'orders', 'db_chaos'), [])).toBeUndefined();
  });
});

describe('E3/3d — validação do que o especialista propõe', () => {
  it('limita os parâmetros, descarta invariante inventado e nunca perde os do projeto', () => {
    const base = defaultSpec(race, INVARIANTS)!;
    const { spec, dropped } = parseSpec(
      JSON.stringify({
        parallel: 5000,
        expect: [
          { kind: 'maxSuccesses', count: 1 },
          { kind: 'stateCheck', name: 'apagarBanco' },
          { kind: 'statusIn', statuses: [201, 409, 'x', 700] },
          { kind: 'executar', code: 'process.exit()' },
        ],
      }),
      base,
      INVARIANTS
    );
    expect(spec).toMatchObject({ kind: 'concurrency', parallel: LIMITS.parallel.max, source: 'ia' });
    expect(spec.expect).toEqual([
      { kind: 'maxSuccesses', count: 1 },
      { kind: 'statusIn', statuses: [201, 409] },
      { kind: 'stateCheck', name: 'stockNeverNegative' },
      { kind: 'stateCheck', name: 'atMostOneOrder' },
    ]);
    expect(dropped).toHaveLength(2);
  });

  it('timeout: o atraso injetado sempre passa da paciência, e a paciência nunca some', () => {
    const base = defaultSpec(timeout, [])!;
    const { spec } = parseSpec(JSON.stringify({ delayMs: 3000, expect: [{ kind: 'respondsWithin', ms: 2500 }] }), base, []);
    expect(spec.kind === 'network' && spec.fault).toEqual({ mode: 'delay', delayMs: 7_500 });

    const noPatience = parseSpec(JSON.stringify({ expect: [{ kind: 'noUnhandledError' }] }), base, []).spec;
    expect(noPatience.expect[0]).toEqual({ kind: 'respondsWithin', ms: 6_000 });
  });

  it('status e corpo inválidos para a falha são descartados; parâmetro de outra falha é ignorado', () => {
    const s5xx = defaultSpec(hyp('http_5xx_intermittent', 'api.stripe.com', 'network'), [])!;
    const r = parseSpec(JSON.stringify({ status: 200, delayMs: 9999 }), s5xx, []);
    expect(r.spec).toMatchObject({ fault: { mode: 'status', status: 503 } });
    expect(r.dropped).toEqual(['status 200 fora de 500/502/503/504']);
    expect(() => parseSpec('ok!', s5xx, [])).toThrow(/JSON/);
  });
});

describe('E3/3d — especialistas no grafo', () => {
  it('offline: uma spec padrão por hipótese testável, em ordem estável', async () => {
    const state = await runChaosPipeline(surface, { invariantNames: INVARIANTS });
    expect(state.specs.map((s) => `${s.kind} ${s.hypothesisId} ${s.source}`)).toEqual([
      `concurrency ${race.id} motor`,
      `network ${timeout.id} motor`,
      'network POST /checkout__http_5xx_intermittent__api.stripe.com motor',
      'network POST /checkout__malformed_response__api.stripe.com motor',
    ]);
    expect(state.completions).toEqual([]);
  });

  it('com IA: o especialista recebe só a hipótese, a rota e os nomes dos invariantes (tier fast, system em cache)', async () => {
    const { p, requests } = provider((req) =>
      req.system.startsWith('Você é o Threat Modeler') ? '{"hypotheses": []}' : req.system.includes('concorrência') ? '{"parallel": 20, "expect": [{"kind":"maxSuccesses","count":1}]}' : '{}'
    );
    const state = await runChaosPipeline(surface, { provider: p, invariantNames: INVARIANTS });
    expect(state.specs.find((s) => s.kind === 'concurrency')).toMatchObject({ parallel: 20, source: 'ia' });
    expect(state.completions).toHaveLength(5);

    const specialistReqs = requests.filter((r) => !r.system.startsWith('Você é o Threat Modeler'));
    expect(specialistReqs).toHaveLength(4);
    for (const r of specialistReqs) {
      expect(r).toMatchObject({ tier: 'fast', json: true, cacheSystem: true });
      const input = JSON.parse(r.messages[0]!.content);
      expect(Object.keys(input).sort()).toEqual(['default', 'hypothesis', 'invariants', 'route']);
      expect(input.invariants).toEqual(INVARIANTS);
    }
  });

  it('especialista com IA fora do ar: fica a spec padrão e o erro é registrado', async () => {
    const r = await specifyTest(race, surface, {
      provider: { name: 'gemini', complete: async () => '', completeWithUsage: async () => { throw new Error('503'); } },
      invariantNames: INVARIANTS,
    });
    expect(r).toMatchObject({ spec: { source: 'motor', parallel: 10 }, error: '503' });
  });
});
