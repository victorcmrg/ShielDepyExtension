// O pipeline de caos como grafo do LangGraph. Os nós chamam o `LLMProvider` do ShielDepy (sem
// chat models do LangChain); o estado só carrega dados validados.
//
//   START → threat_modeler ─(Send, uma por hipótese testável)→ network | concurrency → render → write → END
//
// `render` transforma as specs em `.spec.ts` (templates determinísticos); `write` grava pelo
// `ChaosIo` injetado — o pacote não toca no disco sozinho.

import { Annotation, END, Send, START, StateGraph } from '@langchain/langgraph';
import type { AttackSurface } from '@shieldepy/core';
import type { Completion, Engine, LLMProvider, Logger } from '../provider';
import type { Hypothesis, RejectedHypothesis } from './hypotheses';
import { specifyTest } from './specialists';
import type { ChaosSpec } from './specs';
import { renderChaosTests, type GeneratedFile, type RenderContext } from './templates';
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
  /** Arquivos de teste gerados (e o vitest.config deles). */
  files: Annotation<GeneratedFile[]>({ reducer: last, default: () => [] }),
  /** Contrato incompleto: os testes rodariam, mas cairiam como inválidos. */
  warnings: Annotation<string[]>({ reducer: concat, default: () => [] }),
  /** Caminhos gravados pelo `ChaosIo`. */
  written: Annotation<string[]>({ reducer: last, default: () => [] }),
});

export type ChaosStateType = typeof ChaosState.State;

/** Efeitos colaterais do pipeline, injetados (a CLI grava no disco; os testes, em memória). */
export interface ChaosIo {
  write(files: GeneratedFile[]): Promise<void>;
}

export interface ChaosDeps {
  provider?: LLMProvider;
  /** Nomes dos invariantes declarados pelo projeto (`invariants` do config). */
  invariantNames?: string[];
  log?: Logger;
  signal?: AbortSignal;
  /** Sem isto, o pipeline para nas specs (não gera arquivo). */
  render?: Omit<RenderContext, 'surface' | 'hypotheses'>;
  /** Sem isto, os arquivos ficam só no estado (`files`). */
  io?: ChaosIo;
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
        completions: model.completions,
        errors: model.errors.map((e) => `threat_modeler: ${e}`),
      };
    })
    .addNode('network', specialist)
    .addNode('concurrency', specialist)
    // junta os ramos: roda uma vez, com todas as specs
    .addNode('render', (state) => {
      if (!deps.render) return {};
      const { files, warnings } = renderChaosTests(sortSpecs(state.specs, state.hypotheses), { ...deps.render, surface: state.surface, hypotheses: state.hypotheses });
      return { files, warnings };
    })
    .addNode('write', async (state) => {
      if (!deps.io || state.files.length === 0) return {};
      await deps.io.write(state.files);
      return { written: state.files.map((f) => f.path) };
    })
    .addEdge(START, 'threat_modeler')
    // fan-out: uma execução do especialista por hipótese testável, em paralelo
    .addConditionalEdges(
      'threat_modeler',
      (state) => {
        const sends = state.hypotheses.filter(isSpecifiable).map((h) => new Send(h.agent, { ...state, hypothesis: h }));
        return sends.length > 0 ? sends : 'render';
      },
      ['network', 'concurrency', 'render']
    )
    .addEdge('network', 'render')
    .addEdge('concurrency', 'render')
    .addEdge('render', 'write')
    .addEdge('write', END)
    .compile();
}

/** Roda o pipeline sobre uma superfície de ataque e devolve o estado final (specs em ordem estável). */
export async function runChaosPipeline(surface: AttackSurface, deps: ChaosDeps = {}): Promise<ChaosStateType> {
  const state = await buildChaosGraph(deps).invoke({ surface });
  return { ...state, specs: sortSpecs(state.specs, state.hypotheses) };
}

/** Os ramos paralelos terminam em qualquer ordem; o resultado segue a ordem das hipóteses. */
function sortSpecs(specs: ChaosSpec[], hypotheses: Hypothesis[]): ChaosSpec[] {
  const order = new Map(hypotheses.map((h, i) => [h.id, i]));
  return [...specs].sort((a, b) => order.get(a.hypothesisId)! - order.get(b.hypothesisId)!);
}
