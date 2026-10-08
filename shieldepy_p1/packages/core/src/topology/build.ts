// A topologia: para cada rota, a lista ordenada das operações de I/O que ela alcança, as tags de
// sensibilidade e as colisões no caminho. É isto (e não o código) que a E3 recebe.
// Determinística como o SystemGraph: ids relativos, JSON canônico e hash.

import { createHash } from 'node:crypto';
import type { CodeGraph } from '../code-graph/CodeGraph';
import { isSymbolNode, type CallSite } from '../code-graph/types';
import { keyOf } from '../interactions/graph';
import { collisionKey, collisionRuleIds } from '../interactions/model';
import { canonicalJson, relativeIds, type SystemGraph } from '../system-graph';
import { ioOperationOf } from './io';
import { findExpressRoutes } from './routes';
import type {
  IoOperation,
  Route,
  RouteOperation,
  RouteTag,
  SensitivityTag,
  TopologyCollision,
  TopologyGraph,
  TopologyRoute,
} from './types';

export const TOPOLOGY_VERSION = 1;

/** Profundidade máxima da cadeia handler → ... → operação, e passos por rota (protege repositório grande). */
const MAX_DEPTH = 16;
const MAX_STEPS = 5000;

const TX_OPEN = new Set(['BEGIN', 'START', '$transaction']);
const TX_CLOSE = new Set(['COMMIT', 'ROLLBACK', 'END']);

type TagInput = Pick<IoOperation, 'kind' | 'target' | 'operation' | 'lock' | 'timeout'>;

/**
 * Tags de sensibilidade de uma sequência de operações (na ordem de execução).
 * Transação sem `FOR UPDATE` tira o `no-transaction`, mas o `read-then-write` continua: no
 * READ COMMITTED do Postgres a corrida ainda existe — quem decide é o teste de concorrência.
 */
export function sensitivityTags(ops: TagInput[]): RouteTag[] {
  const tags = new Map<SensitivityTag, Set<string>>();
  const add = (tag: SensitivityTag, target?: string) => {
    let set = tags.get(tag);
    if (!set) tags.set(tag, (set = new Set()));
    if (target) set.add(target);
  };
  let inTransaction = false;
  let apiSeen = false;
  /** Alvo lido → todas as leituras dele estavam protegidas (transação ou trava)? */
  const reads = new Map<string, boolean>();
  const writes = new Map<string, number>();

  for (const op of ops) {
    const known = op.target !== 'dynamic';
    switch (op.kind) {
      case 'api_call':
        apiSeen = true;
        add('external-io', op.target);
        if (op.timeout === 'no') add('no-timeout', op.target);
        break;
      case 'db_tx':
        if (op.operation && TX_OPEN.has(op.operation)) inTransaction = true;
        else if (op.operation && TX_CLOSE.has(op.operation)) inTransaction = false;
        break;
      case 'db_read':
        if (known) reads.set(op.target, (reads.get(op.target) ?? true) && (inTransaction || !!op.lock));
        break;
      case 'db_write': {
        if (apiSeen) add('write-after-api-call', op.target);
        if (!known) break;
        const n = (writes.get(op.target) ?? 0) + 1;
        writes.set(op.target, n);
        if (n === 2) add('multi-write-same-target', op.target);
        const protectedRead = reads.get(op.target);
        if (protectedRead !== undefined) {
          add('read-then-write', op.target);
          if (!protectedRead) add('no-transaction', op.target);
        }
        break;
      }
    }
  }
  return [...tags]
    .map(([tag, set]) => ({ tag, ...(set.size > 0 && { targets: [...set].sort() }) }))
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}

interface Walk {
  operations: Array<Omit<RouteOperation, 'order'>>;
  visited: Set<string>;
  truncated: boolean;
}

/** Monta a topologia a partir do grafo já indexado e do mapa do sistema (de onde vêm as colisões). */
export function buildTopology(graph: CodeGraph, system: SystemGraph, root: string): TopologyGraph {
  const rel = relativeIds(root);

  // callSitesIn resolve o arquivo inteiro: uma vez por arquivo, agrupado por chamador
  const sitesByFile = new Map<string, Map<string, CallSite[]>>();
  const callsOf = (symbolId: string, file: string): CallSite[] => {
    let byCaller = sitesByFile.get(file);
    if (!byCaller) {
      byCaller = new Map();
      for (const site of graph.callSitesIn(file)) {
        const list = byCaller.get(site.caller);
        if (list) list.push(site);
        else byCaller.set(site.caller, [site]);
      }
      sitesByFile.set(file, byCaller);
    }
    return byCaller.get(symbolId) ?? [];
  };
  const fileOfCallable = (id: string): string | undefined => {
    const attrs = graph.nodeAttributes(id);
    return attrs && isSymbolNode(attrs) && (attrs.kind === 'function' || attrs.kind === 'method') ? attrs.file : undefined;
  };

  /** Percorre os handlers em ordem e, dentro de cada um, as chamadas em ordem — em profundidade. */
  const walk = (route: Route): Walk => {
    const result: Walk = { operations: [], visited: new Set(), truncated: false };
    let steps = 0;
    const visit = (symbol: string, through: string[], heuristic: boolean) => {
      const file = fileOfCallable(symbol);
      if (!file || through.includes(symbol)) return;
      if (through.length >= MAX_DEPTH || ++steps > MAX_STEPS) {
        result.truncated = true;
        return;
      }
      result.visited.add(symbol);
      const path = [...through, symbol];
      for (const site of callsOf(symbol, file)) {
        const op = ioOperationOf(site, file);
        if (op) {
          result.operations.push({ ...op, confidence: heuristic ? 'heuristic' : 'proven', through: path });
          continue;
        }
        if (site.outcome !== 'resolved' && site.outcome !== 'heuristic') continue;
        for (const target of site.targets) visit(target, path, heuristic || site.outcome === 'heuristic');
      }
    };
    for (const h of route.handlers) {
      if (h.opaque || h.package) continue;
      for (const symbol of h.symbols) visit(symbol, [], !!h.heuristic);
    }
    return result;
  };

  // regra → símbolo que a implementa (o mapa já fez essa ligação, em ids relativos)
  const ruleSymbol = new Map<string, string>();
  for (const b of system.buckets) for (const r of b.rules) if (r.symbol) ruleSymbol.set(r.id, r.symbol);
  const collisions: TopologyCollision[] = system.collisions.map((c) => ({
    key: collisionKey(c),
    bucket: keyOf(c.resource, c.event),
    collision: c,
    routes: [],
  }));

  const scan = findExpressRoutes(graph);
  const routes: TopologyRoute[] = scan.routes.map((route) => {
    const w = walk(route);
    const visited = new Set([...w.visited].map(rel));
    const touched = collisions.filter((c) => collisionRuleIds(c.collision).some((id) => visited.has(ruleSymbol.get(id) ?? '')));
    const id = route.id;
    for (const c of touched) if (!c.routes.includes(id)) c.routes.push(id);
    const operations: RouteOperation[] = w.operations.map((op, i) => ({
      ...op,
      order: i + 1,
      symbol: rel(op.symbol),
      file: rel(op.file),
      through: op.through.map(rel),
    }));
    const heuristic = route.handlers.some((h) => h.heuristic) || operations.some((o) => o.confidence === 'heuristic');
    return {
      ...route,
      file: rel(route.file),
      handlers: route.handlers.map((h) => ({ ...h, symbols: h.symbols.map(rel) })),
      operations,
      tags: sensitivityTags(operations),
      collisions: touched.map((c) => c.key).sort(),
      reach: [...visited].sort(),
      confidence: heuristic ? 'heuristic' : 'proven',
      ...(w.truncated && { truncated: true as const }),
    };
  });
  for (const c of collisions) c.routes.sort();
  collisions.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const body: Omit<TopologyGraph, 'contentHash'> = {
    version: TOPOLOGY_VERSION,
    systemGraphHash: system.contentHash,
    stats: {
      routes: routes.length,
      sensitiveRoutes: routes.filter(isSensitive).length,
      operations: routes.reduce((n, r) => n + r.operations.length, 0),
      skippedRoutes: scan.skipped.length,
      truncatedRoutes: routes.filter((r) => r.truncated).length,
      collisions: collisions.length,
      callsHeuristic: system.stats.callsHeuristic,
      callsUnresolved: system.stats.callsUnresolved,
    },
    routes,
    skipped: scan.skipped.map((s) => ({ ...s, file: rel(s.file) })),
    collisions,
  };
  const contentHash = createHash('sha256').update(canonicalJson(body)).digest('hex');
  return { ...body, contentHash };
}

/** Rota que interessa ao caos: alcança I/O ou passa por uma colisão. */
export function isSensitive(route: TopologyRoute): boolean {
  return route.operations.length > 0 || route.collisions.length > 0;
}
