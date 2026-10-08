// Resultado da execução dos testes de caos (E4) e a severidade de cada achado. Determinístico:
// a severidade sai da falha injetada e da invariante que quebrou, nunca da IA.

import { severityRank, type Severity } from '../collisions/types';
import type { CostReport } from '../cost';
import type { Engine } from '../provider';
import { catalogEntry, type FailureId } from './catalog';
import type { Hypothesis } from './hypotheses';
import { CHAOS_TESTS_DIR, specFileName } from './templates';

/** `--base` (E5): só as rotas sensíveis que o PR tocou foram testadas. */
export interface ChaosScope {
  /** O ref pedido (`origin/main`) e o merge-base usado. */
  base: string;
  commit: string;
  /** Todas as rotas entraram, e por quê (config, dependência, setup). */
  all?: string;
  /** Rotas sensíveis testadas nesta execução. */
  tested: string[];
  affected: { id: string; why: string[] }[];
  /** Rotas sensíveis que o PR não tocou (ficaram de fora). */
  untouched: string[];
}

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

/** Arquivo que a CLI grava a cada execução e o visualizador (CLI e extensão) põe sobre o mapa. */
export const CHAOS_RESULTS_FILE = '.shieldepy/chaos-results.json';

/** O resultado de uma execução do `shieldepy chaos`, para o visualizador (V2) e para outras ferramentas. */
export interface ChaosResults {
  version: 1;
  /** Nome do projeto (a pasta). */
  project: string;
  /** A topologia de onde as hipóteses saíram: o visualizador avisa quando o mapa aberto é outro. */
  topologyHash: string;
  /** Quem escreveu as hipóteses. */
  engine: Engine;
  /** Os testes rodaram (`false` com `--no-run` ou erro de ambiente). */
  ran: boolean;
  runError?: string;
  failOn: Severity;
  /** Achados no portão (severidade `failOn` ou pior). */
  hits: number;
  scope?: ChaosScope;
  /** Cada teste que rodou, com o arquivo do teste (relativo ao projeto). */
  outcomes: (ChaosOutcome & { testFile: string })[];
  /** Hipóteses sem teste nesta execução, e por quê. */
  untested: { id: string; routeId: string; failure: FailureId; target: string; reason: string }[];
  cost: CostReport;
}

export function buildChaosResults(input: {
  project: string;
  topologyHash: string;
  engine: Engine;
  hypotheses: Hypothesis[];
  outcomes?: ChaosOutcome[];
  runError?: string;
  failOn: Severity;
  hits: number;
  scope?: ChaosScope;
  cost: CostReport;
}): ChaosResults {
  const outcomes = input.outcomes ?? [];
  const tested = new Set(outcomes.map((o) => o.hypothesisId));
  return {
    version: 1,
    project: input.project,
    topologyHash: input.topologyHash,
    engine: input.engine,
    ran: !!input.outcomes,
    ...(input.runError && { runError: input.runError }),
    failOn: input.failOn,
    hits: input.hits,
    ...(input.scope && { scope: input.scope }),
    outcomes: outcomes.map((o) => ({ ...o, testFile: `${CHAOS_TESTS_DIR}/${specFileName(o.hypothesisId)}` })),
    untested: input.hypotheses
      .filter((h) => !tested.has(h.id))
      .map((h) => ({
        id: h.id,
        routeId: h.routeId,
        failure: h.failure,
        target: h.target,
        reason: !h.testable
          ? catalogEntry(h.failure)?.agent === 'db_chaos'
            ? 'precisa de falha injetada no banco (DB_Chaos, depois)'
            : 'sem template de teste no MVP'
          : input.runError
            ? 'os testes não rodaram (erro de ambiente)'
            : input.outcomes
              ? 'sem resultado'
              : 'não executado (--no-run)',
      })),
    cost: input.cost,
  };
}
