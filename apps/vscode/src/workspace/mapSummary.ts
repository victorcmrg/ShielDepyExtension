import { buildSystemGraph, buildTopology, type CodeGraph, type Rule } from '@shieldepy/core';

/** O que o mapa achou no projeto aberto: é o que a extensão conta quando termina de indexar (M6). */
export interface MapSummary {
  files: number;
  routes: number;
  sensitive: number;
  operations: number;
  /** % das chamadas internas provadas (0–100, inteiro). */
  proven: number;
  /** Chamadas internas sem prova (por nome ou sem alvo): onde o percurso de uma rota pode ter buraco. */
  weak: number;
}

/** Monta a topologia uma vez (sem reindexar) e resume o mapa. */
export function summarizeMap(graph: CodeGraph, rules: Rule[], root: string): MapSummary {
  const topology = buildTopology(graph, buildSystemGraph(graph, rules, root), root);
  const s = graph.stats;
  const internal = s.callsResolved + s.callsHeuristic + s.callsUnresolved;
  return {
    files: graph.files().length,
    routes: topology.stats.routes,
    sensitive: topology.stats.sensitiveRoutes,
    operations: topology.stats.operations,
    proven: internal === 0 ? 100 : Math.floor((100 * s.callsResolved) / internal),
    weak: s.callsHeuristic + s.callsUnresolved,
  };
}
