// Hipóteses de falha: a lista-base do motor (direto das tags) e a validação do que a IA propõe.
// A IA não tira nada da lista-base; ela explica, prioriza e pode acrescentar falhas do catálogo
// que a lista-base não inclui. Tudo que ela disser fora do catálogo ou da superfície é descartado.

import type { AttackSurface, SurfaceRoute } from '@shieldepy/core';
import { CATALOG, catalogEntry, type ChaosAgent, type FailureId } from './catalog';

/** 1 = alta, 3 = baixa. */
export type Priority = 1 | 2 | 3;

export interface Hypothesis {
  /** `POST /checkout__race_condition__stock` — estável, vira nome de arquivo do teste. */
  id: string;
  routeId: string;
  failure: FailureId;
  agent: ChaosAgent;
  /** Host da API (rede) ou tabela (concorrência/banco). */
  target: string;
  priority: Priority;
  rationale: string;
  /** `motor`: só da lista-base; `ia`: só da IA; `motor+ia`: da base, com o texto da IA. */
  source: 'motor' | 'ia' | 'motor+ia';
  /** Há template de teste no MVP. */
  testable: boolean;
}

export interface RejectedHypothesis {
  index: number;
  reason: string;
}

export const hypothesisId = (routeId: string, failure: string, target: string) => `${routeId}__${failure}__${target}`;

const MAX_RATIONALE = 600;

/** Prioridade padrão do motor: corrida e falha de API sem timeout primeiro. */
function defaultPriority(failure: FailureId): Priority {
  return failure === 'race_condition' || failure === 'timeout' ? 1 : failure === 'partial_failure_after_external_call' ? 2 : 3;
}

function offlineRationale(route: SurfaceRoute, failure: FailureId, target: string): string {
  // só as tags que tocam este alvo: a corrida em `stock` não precisa citar o timeout do Stripe
  const tags = route.tags.filter((t) => t.targets?.includes(target)).map((t) => `${t.tag}(${target})`);
  const entry = catalogEntry(failure)!;
  const ops = route.operations.filter((o) => o.target === target).map((o) => `${o.kind} em ${o.in}`);
  const evidence = [...tags, ...ops.slice(0, 3)].join(', ');
  return `${entry.description} Em ${route.id}: ${evidence || 'operações de I/O'}.`;
}

/** A lista-base: toda falha do catálogo (marcada `baseline`) que as tags de cada rota habilitam. */
export function baselineHypotheses(surface: AttackSurface): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const route of surface.routes) {
    for (const entry of CATALOG) {
      if (!entry.baseline) continue;
      for (const target of entry.targets(route)) {
        out.push({
          id: hypothesisId(route.id, entry.id, target),
          routeId: route.id,
          failure: entry.id,
          agent: entry.agent,
          target,
          priority: defaultPriority(entry.id),
          rationale: offlineRationale(route, entry.id, target),
          source: 'motor',
          testable: entry.testable,
        });
      }
    }
  }
  return sortHypotheses(out);
}

/**
 * Valida a resposta da IA (`{ hypotheses: [...], summary? }`) contra o catálogo e a superfície.
 * Lança se não for JSON no formato esperado (quem chama cai no offline); item inválido vai para `rejected`.
 */
export function parseThreatModel(
  text: string,
  surface: AttackSurface
): { hypotheses: Hypothesis[]; rejected: RejectedHypothesis[]; summary?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('resposta da IA não é JSON válido');
  }
  const obj = parsed as { hypotheses?: unknown; summary?: unknown };
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.hypotheses)) throw new Error('JSON da IA sem a lista "hypotheses"');

  const routes = new Map(surface.routes.map((r) => [r.id, r]));
  const hypotheses: Hypothesis[] = [];
  const rejected: RejectedHypothesis[] = [];
  const seen = new Set<string>();
  obj.hypotheses.forEach((raw: unknown, index: number) => {
    const h = (raw ?? {}) as Record<string, unknown>;
    const reject = (reason: string) => rejected.push({ index, reason });
    const route = typeof h.routeId === 'string' ? routes.get(h.routeId) : undefined;
    if (!route) return reject(`rota fora da superfície: ${String(h.routeId)}`);
    const entry = typeof h.failure === 'string' ? catalogEntry(h.failure) : undefined;
    if (!entry) return reject(`falha fora do catálogo: ${String(h.failure)}`);
    const allowed = entry.targets(route);
    if (allowed.length === 0) return reject(`${entry.id} não é habilitada pelas tags de ${route.id}`);
    // alvo omitido vale quando só existe um; alvo inventado é descartado
    const target = typeof h.target === 'string' ? h.target : allowed.length === 1 ? allowed[0]! : undefined;
    if (!target || !allowed.includes(target)) return reject(`alvo ${String(h.target)} não existe em ${route.id} para ${entry.id} (válidos: ${allowed.join(', ')})`);
    const id = hypothesisId(route.id, entry.id, target);
    if (seen.has(id)) return reject(`repetida: ${id}`);
    seen.add(id);
    const priority = h.priority === 1 || h.priority === 2 || h.priority === 3 ? h.priority : defaultPriority(entry.id);
    const rationale = typeof h.rationale === 'string' && h.rationale.trim() ? h.rationale.trim().slice(0, MAX_RATIONALE) : offlineRationale(route, entry.id, target);
    hypotheses.push({ id, routeId: route.id, failure: entry.id, agent: entry.agent, target, priority, rationale, source: 'ia', testable: entry.testable });
  });
  const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim().slice(0, 2000) : undefined;
  return { hypotheses, rejected, ...(summary && { summary }) };
}

/** Base do motor + o que a IA validou: a IA dá o texto e a prioridade, nunca remove da base. */
export function mergeHypotheses(baseline: Hypothesis[], ai: Hypothesis[]): Hypothesis[] {
  const byId = new Map(baseline.map((h) => [h.id, h]));
  for (const h of ai) {
    const base = byId.get(h.id);
    byId.set(h.id, base ? { ...base, priority: h.priority, rationale: h.rationale, source: 'motor+ia' } : h);
  }
  return sortHypotheses([...byId.values()]);
}

function sortHypotheses(list: Hypothesis[]): Hypothesis[] {
  return list.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
