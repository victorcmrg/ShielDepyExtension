// O pipeline de caos como grafo do LangGraph. Os nós chamam o `LLMProvider` do ShielDepy (sem
// chat models do LangChain); o estado só carrega dados validados.
//   E3/3c: START → threat_modeler → END
//   E3/3d em diante: threat_modeler → especialistas (fan-out por Send) → render → write

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { AttackSurface } from '@shieldepy/core';
import type { Completion, Engine } from '../provider';
import type { Hypothesis, RejectedHypothesis } from './hypotheses';
import { modelThreats, type ThreatModelerDeps } from './threat-modeler';

const concat = <T>(a: T[], b: T[]) => a.concat(b);

export const ChaosState = Annotation.Root({
  /** Entrada: o recorte da topologia que a IA pode ver. */
  surface: Annotation<AttackSurface>(),
  hypotheses: Annotation<Hypothesis[]>({ reducer: (_a, b) => b, default: () => [] }),
  rejected: Annotation<RejectedHypothesis[]>({ reducer: concat, default: () => [] }),
  /** Quem escreveu as hipóteses: a IA ou o motor (offline). */
  engine: Annotation<Engine>({ reducer: (_a, b) => b, default: () => 'offline' }),
  summary: Annotation<string | undefined>({ reducer: (_a, b) => b, default: () => undefined }),
  /** Cada chamada à IA, com tokens — o custo da execução sai daqui. */
  completions: Annotation<Completion[]>({ reducer: concat, default: () => [] }),
  /** Problemas que não param o pipeline (IA fora do ar, resposta descartada). */
  errors: Annotation<string[]>({ reducer: concat, default: () => [] }),
});

export type ChaosStateType = typeof ChaosState.State;

export function buildChaosGraph(deps: ThreatModelerDeps = {}) {
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
    .addEdge(START, 'threat_modeler')
    .addEdge('threat_modeler', END)
    .compile();
}

/** Roda o pipeline sobre uma superfície de ataque e devolve o estado final. */
export async function runChaosPipeline(surface: AttackSurface, deps: ThreatModelerDeps = {}): Promise<ChaosStateType> {
  return buildChaosGraph(deps).invoke({ surface });
}
