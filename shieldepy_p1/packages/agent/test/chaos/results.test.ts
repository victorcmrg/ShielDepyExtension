import { describe, expect, it } from 'vitest';
import { chaosOutcomes, chaosSeverity, gateHits, type Hypothesis, type TestResult } from '../../src/chaos';

const hyp = (routeId: string, failure: Hypothesis['failure'], target: string): Hypothesis => ({
  id: `${routeId}__${failure}__${target}`,
  routeId,
  failure,
  agent: failure === 'race_condition' ? 'concurrency' : 'network',
  target,
  priority: 1,
  rationale: '',
  source: 'motor',
  testable: true,
});

describe('E4/4b — severidade e portão', () => {
  it('corrida e estado corrompido são Crítico; rota pendurada ou 500 é Alto; status errado é Médio', () => {
    expect(chaosSeverity('race_condition', 'statusIn: a rota respondeu 409')).toBe('Crítico');
    expect(chaosSeverity('partial_failure_after_external_call', undefined)).toBe('Crítico');
    expect(chaosSeverity('http_5xx_intermittent', 'stateCheck: atMostOneOrder')).toBe('Crítico');
    expect(chaosSeverity('timeout', 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta')).toBe('Alto');
    expect(chaosSeverity('malformed_response', 'statusIn: a rota não respondeu em 10011 ms')).toBe('Alto');
    expect(chaosSeverity('http_5xx_intermittent', 'noUnhandledError: a falha virou 500 (exceção não tratada)')).toBe('Alto');
    expect(chaosSeverity('http_5xx_intermittent', 'statusIn: a rota respondeu 200')).toBe('Médio');
  });

  it('junta resultado e hipótese, mais grave primeiro; só achados entram no portão', () => {
    const hs = [hyp('POST /checkout', 'timeout', 'api.stripe.com'), hyp('POST /checkout', 'race_condition', 'stock'), hyp('POST /checkout', 'http_5xx_intermittent', 'api.stripe.com')];
    const results: TestResult[] = [
      { hypothesisId: hs[0]!.id, status: 'failed', message: 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta', durationMs: 6000 },
      { hypothesisId: hs[1]!.id, status: 'failed', message: 'stateCheck: stockNeverNegative', durationMs: 200 },
      { hypothesisId: hs[2]!.id, status: 'invalid', message: 'o controle (sem caos) falhou: x', durationMs: 100 },
      { hypothesisId: 'POST /x__timeout__y', status: 'failed', durationMs: 1 }, // sem hipótese: fora
    ];
    const outcomes = chaosOutcomes(results, hs);
    expect(outcomes.map((o) => [o.failure, o.status, o.severity])).toEqual([
      ['race_condition', 'failed', 'Crítico'],
      ['timeout', 'failed', 'Alto'],
      ['http_5xx_intermittent', 'invalid', undefined],
    ]);
    expect(outcomes[0]).toMatchObject({ routeId: 'POST /checkout', target: 'stock' });
    expect(gateHits(outcomes, 'Crítico').map((o) => o.failure)).toEqual(['race_condition']);
    expect(gateHits(outcomes, 'Alto')).toHaveLength(2);
    expect(gateHits(outcomes, 'Baixo')).toHaveLength(2); // o inválido nunca bloqueia
  });
});
