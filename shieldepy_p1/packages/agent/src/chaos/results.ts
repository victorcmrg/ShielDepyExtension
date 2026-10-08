// Resultado da execução dos testes de caos (E4) e a severidade de cada achado. Determinístico:
// a severidade sai da falha injetada e da invariante que quebrou, nunca da IA.

import { severityRank, type Severity } from '../collisions/types';
import type { FailureId } from './catalog';
import type { Hypothesis } from './hypotheses';

export type TestStatus = 'passed' | 'failed' | 'invalid';

export interface TestResult {
  hypothesisId: string;
  status: TestStatus;
  /** `failed`: a invariante violada; `invalid`: por que o resultado não vale. */
  message?: string;
  /** Duração do teste de caos (ou do controle, quando só ele rodou). */
  durationMs: number;
}

/** Um teste que rodou, com a hipótese de onde veio e, se quebrou, a severidade. */
export interface ChaosOutcome extends TestResult {
  routeId: string;
  failure: FailureId;
  target: string;
  severity?: Severity;
}

/**
 * Severidade de um achado (controle passou, caos falhou):
 * - **Crítico:** corrida ou falha parcial, ou qualquer falha que corrompa o estado
 *   (`stateCheck`, `maxSuccesses`: estoque negativo, venda em dobro, pedido sem cobrança);
 * - **Alto:** a rota fica pendurada ou a falha vira 500 (`respondsWithin`, "não respondeu",
 *   `noUnhandledError`);
 * - **Médio:** a rota responde, mas com um status fora do esperado (`statusIn`).
 */
export function chaosSeverity(failure: FailureId, message: string | undefined): Severity {
  if (failure === 'race_condition' || failure === 'partial_failure_after_external_call') return 'Crítico';
  const m = message ?? '';
  if (m.startsWith('stateCheck') || m.startsWith('maxSuccesses')) return 'Crítico';
  if (m.startsWith('respondsWithin') || m.startsWith('noUnhandledError') || m.includes('não respondeu')) return 'Alto';
  return 'Médio';
}

/** Junta cada resultado à sua hipótese e dá a severidade dos achados; mais grave primeiro. */
export function chaosOutcomes(results: TestResult[], hypotheses: Hypothesis[]): ChaosOutcome[] {
  const byId = new Map(hypotheses.map((h) => [h.id, h]));
  const rank = (o: ChaosOutcome) => (o.status === 'failed' ? severityRank(o.severity!) : o.status === 'invalid' ? 10 : 20);
  return results
    .flatMap((r) => {
      const h = byId.get(r.hypothesisId);
      if (!h) return [];
      const outcome: ChaosOutcome = { ...r, routeId: h.routeId, failure: h.failure, target: h.target };
      if (r.status === 'failed') outcome.severity = chaosSeverity(h.failure, r.message);
      return [outcome];
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** Achados com severidade `failOn` ou pior (o portão do CI). */
export function gateHits(outcomes: ChaosOutcome[], failOn: Severity): ChaosOutcome[] {
  return outcomes.filter((o) => o.status === 'failed' && severityRank(o.severity!) <= severityRank(failOn));
}
