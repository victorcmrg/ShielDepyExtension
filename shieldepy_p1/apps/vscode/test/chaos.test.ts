import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChaosResults } from '@shieldepy/agent/chaos';
import { chaosToFindings } from '../src/chaos/chaosFindings';

const op = (order: number, kind: string, target: string, at: string, inFn: string) => ({ order, kind, target, via: kind === 'api_call' ? 'fetch' : 'pg', at, in: inFn, confidence: 'proven' as const });
const outcome = (failure: string, target: string, status: 'failed' | 'passed' | 'invalid', message?: string, severity?: string) => ({
  hypothesisId: `POST /checkout__${failure}__${target}`,
  routeId: 'POST /checkout',
  failure,
  target,
  status,
  message,
  severity,
  durationMs: 100,
  testFile: `.shieldepy/chaos-tests/POST__checkout__${failure}__${target}.spec.ts`,
});

/** O checkout vulnerável: lê o estoque, cobra no Stripe, baixa o estoque e grava o pedido. */
const results = {
  version: 1,
  project: 'checkout',
  topologyHash: 'x',
  engine: 'offline',
  ran: true,
  failOn: 'Baixo',
  hits: 3,
  outcomes: [
    outcome('race_condition', 'stock', 'failed', 'stateCheck: stockNeverNegative', 'Crítico'),
    outcome('partial_failure_after_external_call', 'orders', 'failed', 'stateCheck: noChargeWithoutOrder', 'Crítico'),
    outcome('timeout', 'api.stripe.com', 'failed', 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta', 'Alto'),
    outcome('http_5xx_intermittent', 'api.stripe.com', 'passed'),
    outcome('partial_failure_after_external_call', 'stock', 'invalid', 'a falha não disparou'),
  ],
  untested: [],
  cost: {},
  surface: {
    version: 1,
    topologyHash: 'x',
    collisions: [],
    routes: [
      {
        id: 'POST /checkout',
        method: 'POST',
        path: '/checkout',
        at: 'src/routes/checkout.ts:8',
        handlers: [],
        tags: [],
        collisions: [],
        confidence: 'proven',
        operations: [
          op(1, 'db_read', 'stock', 'src/repositories/StockRepository.ts:7', 'StockRepository.available'),
          op(2, 'api_call', 'api.stripe.com', 'src/gateways/StripeGateway.ts:8', 'StripeGateway.charge'),
          op(3, 'db_write', 'stock', 'src/repositories/StockRepository.ts:12', 'StockRepository.decrement'),
          op(4, 'db_write', 'orders', 'src/repositories/OrderRepository.ts:14', 'OrderRepository.insert'),
        ],
      },
    ],
  },
} as unknown as ChaosResults;

const dir = path.resolve('/projeto/checkout');
const rel = (f: string) => path.relative(dir, f).split(path.sep).join('/');

describe('o resultado do caos vira erro na linha da operação atingida', () => {
  const findings = chaosToFindings(results, dir);

  it('só os testes que quebraram, cada um na operação certa (linha 0-based)', () => {
    expect(findings.map((f) => `${rel(f.file)}:${f.startLine + 1} ${f.severity}`)).toEqual([
      // corrida: a escrita no estoque (não a leitura)
      'src/repositories/StockRepository.ts:12 error',
      // falha parcial: a gravação do pedido depois da cobrança
      'src/repositories/OrderRepository.ts:14 error',
      // timeout: a chamada ao Stripe
      'src/gateways/StripeGateway.ts:8 error',
    ]);
  });

  it('a mensagem diz o que quebrou e a invariante; o teste e a rota vão como pontos relacionados', () => {
    const partial = findings.find((f) => f.message.startsWith('Falha parcial'))!;
    expect(partial.message).toBe(
      'Falha parcial em orders: a API externa já foi chamada, a gravação falhou e nada foi compensado. Invariante violada: stateCheck: noChargeWithoutOrder (POST /checkout).'
    );
    expect(partial).toMatchObject({ source: 'caos', confidence: 100, impact: 'Teste de caos (Crítico) em OrderRepository.insert.' });
    expect(partial.related!.map((r) => `${rel(r.file)}:${r.line + 1}`)).toEqual([
      '.shieldepy/chaos-tests/POST__checkout__partial_failure_after_external_call__orders.spec.ts:1',
      'src/routes/checkout.ts:8',
    ]);
  });

  it('sem a topologia no resultado, o achado vai para a rota (ou some, se nem ela houver)', () => {
    const semRotas = { ...results, surface: undefined } as unknown as ChaosResults;
    expect(chaosToFindings(semRotas, dir)).toEqual([]);
  });
});
