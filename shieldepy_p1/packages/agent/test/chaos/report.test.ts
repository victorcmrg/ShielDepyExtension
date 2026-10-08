import type { AttackSurface } from '@shieldepy/core';
import { describe, expect, it } from 'vitest';
import type { CompletionRequest, LLMProvider } from '../../src/provider';
import { CostMeter } from '../../src/cost';
import {
  baselineHypotheses,
  chaosOutcomes,
  CHAOS_REPORT_MARKER,
  explainChaosOutcomes,
  renderChaosReport,
  type ChaosOutcome,
  type TestResult,
} from '../../src/chaos';

const surface: AttackSurface = {
  version: 1,
  topologyHash: 'c4568dc36e2e4331'.padEnd(64, '0'),
  routes: [
    {
      id: 'POST /checkout',
      method: 'POST',
      path: '/checkout',
      at: 'src/routes/checkout.ts:8',
      handlers: ['validateCheckout', 'create'],
      operations: [
        { order: 1, kind: 'db_read', target: 'stock', via: 'pg', at: 'src/repositories/StockRepository.ts:7', in: 'available', confidence: 'proven' },
        { order: 2, kind: 'api_call', target: 'api.stripe.com', via: 'fetch', timeout: 'no', at: 'src/gateways/StripeGateway.ts:8', in: 'charge', confidence: 'proven' },
        { order: 3, kind: 'db_write', target: 'stock', via: 'pg', at: 'src/repositories/StockRepository.ts:12', in: 'decrement', confidence: 'proven' },
        { order: 4, kind: 'db_write', target: 'orders', via: 'pg', at: 'src/repositories/OrderRepository.ts:14', in: 'insert', confidence: 'proven' },
      ],
      tags: [
        { tag: 'external-io', targets: ['api.stripe.com'] },
        { tag: 'no-timeout', targets: ['api.stripe.com'] },
        { tag: 'read-then-write', targets: ['stock'] },
        { tag: 'no-transaction', targets: ['stock'] },
        { tag: 'write-after-api-call', targets: ['orders', 'stock'] },
      ],
      collisions: [],
      confidence: 'proven',
    },
  ],
  collisions: [],
} as unknown as AttackSurface;

const hypotheses = baselineHypotheses(surface);
const id = (failure: string, target: string) => `POST /checkout__${failure}__${target}`;

function outcomes(byId: Record<string, [TestResult['status'], string?]>): ChaosOutcome[] {
  const ids = hypotheses.filter((h) => h.testable).map((h) => h.id);
  return chaosOutcomes(
    ids.map((x) => ({ hypothesisId: x, status: byId[x]?.[0] ?? 'passed', message: byId[x]?.[1], durationMs: 6036 })),
    hypotheses
  );
}

const base = { label: 'checkout-express', surface, hypotheses, engine: 'offline' as const, cost: new CostMeter().report() };

describe('E4/4c — relatório markdown', () => {
  it('achados: tabela com severidade e invariante, operações com arquivo:linha e o alvo marcado, sem teste e rodapé', () => {
    const o = outcomes({ [id('race_condition', 'stock')]: ['failed', 'stateCheck: stockNeverNegative'], [id('timeout', 'api.stripe.com')]: ['failed', 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta'] });
    const md = renderChaosReport({ ...base, outcomes: o, failOn: 'Alto', hits: 2 });
    expect(md.startsWith(CHAOS_REPORT_MARKER)).toBe(true);
    expect(md).toContain('> ❌ **Bloqueado:** 2 achado(s) com severidade Alto ou pior.');
    expect(md).toContain('| 🔴 Crítico | `POST /checkout` | `race_condition` | `stock` | stateCheck: stockNeverNegative | 6,0 s |');
    expect(md).toContain('| 🟠 Alto | `POST /checkout` | `timeout` | `api.stripe.com` |');
    expect(md).toContain('- **1. `db_read stock` em `available` (`src/repositories/StockRepository.ts:7`)** ← alvo da falha');
    expect(md).toContain('- 2. `api_call api.stripe.com` em `charge` (`src/gateways/StripeGateway.ts:8`), sem timeout');
    expect(md).toContain('`.shieldepy/chaos-tests/POST__checkout__race_condition__stock.spec.ts`');
    expect(md).toMatch(/### Aguentou\n\n- ✅ `POST \/checkout` · http_5xx_intermittent/);
    expect(md).toMatch(/partial_failure_after_external_call em `orders`: precisa de falha injetada no banco/);
    expect(md).toContain('IA: nenhuma chamada (custo zero) · topologia `c4568dc36e2e4331`');
  });

  it('passou, abaixo do portão, inválidos, erro de ambiente e --no-run têm cada um a sua linha de status', () => {
    expect(renderChaosReport({ ...base, outcomes: outcomes({}), failOn: 'Baixo', hits: 0 })).toContain('> ✅ **Passou:** o código aguentou todas as falhas injetadas.');
    const below = outcomes({ [id('timeout', 'api.stripe.com')]: ['failed', 'respondsWithin: x'] });
    expect(renderChaosReport({ ...base, outcomes: below, failOn: 'Crítico', hits: 0 })).toContain('> ✅ **Passou no portão** (Crítico ou pior), com 1 achado(s) abaixo dele.');
    const allInvalid = outcomes(Object.fromEntries(hypotheses.map((h) => [h.id, ['invalid', 'o controle (sem caos) falhou: x | y']])));
    const md = renderChaosReport({ ...base, outcomes: allInvalid, failOn: 'Baixo', hits: 0 });
    expect(md).toContain('> ⚠️ **Nada foi provado:**');
    expect(md).toContain('o controle (sem caos) falhou: x \\| y'); // `|` escapado
    expect(renderChaosReport({ ...base, failOn: 'Baixo', hits: 0, runError: 'o Vitest não está instalado em x\nmais' })).toContain('> ⚠️ **Os testes não rodaram (erro de ambiente).** o Vitest não está instalado em x');
    expect(renderChaosReport({ ...base, failOn: 'Baixo', hits: 0 })).toContain('não executados (`--no-run`)');
  });
});

describe('E4/4c — parágrafo da IA', () => {
  const found = outcomes({ [id('race_condition', 'stock')]: ['failed', 'stateCheck: stockNeverNegative'] });
  const fake = (text: string | Error, seen: CompletionRequest[] = []): LLMProvider => ({
    name: 'anthropic',
    complete: async () => '',
    completeWithUsage: async (req) => {
      seen.push(req);
      if (text instanceof Error) throw text;
      return { text, model: 'claude-haiku-4-5', usage: { inputTokens: 900, outputTokens: 120 } };
    },
  });

  it('sem provider ou sem achado: parágrafo do motor (ou nada)', async () => {
    const r = await explainChaosOutcomes(found, surface);
    expect(r).toMatchObject({ engine: 'offline' });
    expect(r.text).toBe('**Resumo:** requisições simultâneas em POST /checkout corrompem stock (stateCheck: stockNeverNegative).');
    expect((await explainChaosOutcomes(outcomes({}), surface, { provider: fake('{}') })).text).toBe('');
  });

  it('com provider: só fatos (achados + operações, sem código), tier fast, e o parágrafo validado', async () => {
    const seen: CompletionRequest[] = [];
    const r = await explainChaosOutcomes(found, surface, { provider: fake('{"paragraph": "Lê stock, espera o Stripe e só depois grava."}', seen) });
    expect(r).toMatchObject({ engine: 'anthropic', text: '**Leitura da IA:** Lê stock, espera o Stripe e só depois grava.' });
    expect(r.completion?.usage?.inputTokens).toBe(900);
    expect(seen[0]).toMatchObject({ tier: 'fast', json: true });
    const facts = seen[0]!.messages[0]!.content;
    expect(facts).toContain('"violated": "stateCheck: stockNeverNegative"');
    expect(facts).toContain('"at": "src/repositories/StockRepository.ts:7"');
  });

  it('resposta inválida, com bloco de código ou IA fora do ar: cai no parágrafo do motor, com o motivo (e o custo da chamada)', async () => {
    for (const bad of ['não é json', '{"paragraph": ""}', '{"paragraph": "```ts\\nfix()\\n```"}']) {
      const r = await explainChaosOutcomes(found, surface, { provider: fake(bad) });
      expect(r.engine).toBe('offline');
      expect(r.text).toMatch(/^\*\*Resumo:\*\*/);
      expect(r.error).toBeTruthy();
      expect(r.completion).toBeDefined();
    }
    const down = await explainChaosOutcomes(found, surface, { provider: fake(new Error('503')) });
    expect(down).toMatchObject({ engine: 'offline', error: '503' });
  });
});
