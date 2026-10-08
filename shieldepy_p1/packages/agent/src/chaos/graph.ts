// O pipeline de caos como grafo do LangGraph. Os nós chamam o `LLMProvider` do ShielDepy (sem
// chat models do LangChain); o estado só carrega dados validados.
//
//   START → threat_modeler ─(Send, uma por hipótese testável)→ network | concurrency → END
//
// E3/3e acrescenta render → write depois dos especialistas.

import { Annotation, END, Send, START, StateGraph } from '@langchain/langgraph';
import type { AttackSurface } from '@shieldepy/core';
import type { Completion, Engine, LLMProvider, Logger } from '../provider';
import type { Hypothesis, RejectedHypothesis } from './hypotheses';
import { specifyTest } from './specialists';
import type { ChaosSpec } from './specs';
import { modelThreats } from './threat-modeler';

const concat = <T>(a: T[], b: T[]) => a.concat(b);
const last = <T>(_a: T, b: T) => b;

export const ChaosState = Annotation.Root({
  /** Entrada: o recorte da topologia que a IA pode ver. */
  surface: Annotation<AttackSurface>(),
  hypotheses: Annotation<Hypothesis[]>({ reducer: last, default: () => [] }),
  rejected: Annotation<RejectedHypothesis[]>({ reducer: concat, default: () => [] }),
  /** Quem escreveu as hipóteses: a IA ou o motor (offline). */
  engine: Annotation<Engine>({ reducer: last, default: () => 'offline' }),
  summary: Annotation<string | undefined>({ reducer: last, default: () => undefined }),
  /** A hipótese que um especialista recebe pelo `Send` (só existe dentro do ramo dele). */
  hypothesis: Annotation<Hypothesis | undefined>({ reducer: last, default: () => undefined }),
  specs: Annotation<ChaosSpec[]>({ reducer: concat, default: () => [] }),
  /** Cada chamada à IA, com tokens — o custo da execução sai daqui. */
  completions: Annotation<Completion[]>({ reducer: concat, default: () => [] }),
  /** Problemas que não param o pipeline (IA fora do ar, resposta descartada). */
  errors: Annotation<string[]>({ reducer: concat, default: () => [] }),
});

export type ChaosStateType = typeof ChaosState.State;

export interface ChaosDeps {
  provider?: LLMProvider;
  /** Nomes dos invariantes declarados pelo projeto (`invariants` do config). */
  invariantNames?: string[];
  log?: Logger;
  signal?: AbortSignal;
}

/** Hipóteses que viram teste no MVP (rede e concorrência). */
const isSpecifiable = (h: Hypothesis) => h.testable && (h.agent === 'network' || h.agent === 'concurrency');

export function buildChaosGraph(deps: ChaosDeps = {}) {
  const specialist = async (state: ChaosStateType) => {
    const h = state.hypothesis!;
    const r = await specifyTest(h, state.surface, deps);
    return {
      specs: r.spec ? [r.spec] : [],
      completions: r.completion ? [r.completion] : [],
      errors: r.error ? [`${h.agent} ${h.id}: ${r.error}`] : [],
    };
  };

  return new StateGraph(ChaosState)
    .addNode('threat_modeler', async (state) => {
      const model = await modelThreats(state.surface, deps);
      return {
        hypotheses: model.hypotheses,
        rejected: model.rejected,
        engine: model.engine,
        summary: model.summary,
        completions: model.completion ? [model.completion] : [],
        errors: model.error ? [`threat_modeler: ${model.error}`] : [],
      };
    })
    .addNode('network', specialist)
    .addNode('concurrency', specialist)
    .addEdge(START, 'threat_modeler')
    // fan-out: uma execução do especialista por hipótese testável, em paralelo
    .addConditionalEdges(
      'threat_modeler',
      (state) => {
        const sends = state.hypotheses.filter(isSpecifiable).map((h) => new Send(h.agent, { ...state, hypothesis: h }));
        return sends.length > 0 ? sends : END;
      },
      ['network', 'concurrency', END]
    )
    .addEdge('network', END)
    .addEdge('concurrency', END)
    .compile();
}

/** Roda o pipeline sobre uma superfície de ataque e devolve o estado final (specs em ordem estável). */
export async function runChaosPipeline(surface: AttackSurface, deps: ChaosDeps = {}): Promise<ChaosStateType> {
  const state = await buildChaosGraph(deps).invoke({ surface });
  // os ramos paralelos terminam em qualquer ordem; o resultado não pode depender disso
  const order = new Map(state.hypotheses.map((h, i) => [h.id, i]));
  return { ...state, specs: [...state.specs].sort((a, b) => order.get(a.hypothesisId)! - order.get(b.hypothesisId)!) };
}
