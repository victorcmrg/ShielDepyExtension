// Superfície de ataque: o recorte da topologia que vai para a IA (Threat Modeler, E3).
// Só rotas que alcançam I/O ou passam por colisão, e só fatos — nenhuma linha de código-fonte.
// Localizações em `arquivo:linha` 1-based, como uma pessoa (ou o modelo) leria.

import { isSensitive } from './build';
import type { RouteTag, TopologyGraph } from './types';

export interface SurfaceOperation {
  order: number;
  kind: string;
  target: string;
  via: string;
  operation?: string;
  lock?: true;
  timeout?: string;
  /** `src/repositories/StockRepository.ts:7` */
  at: string;
  /** Função que faz a operação (`decrement`). */
  in: string;
  confidence: 'proven' | 'heuristic';
}

export interface SurfaceRoute {
  id: string;
  method: string;
  path: string;
  at: string;
  handlers: string[];
  operations: SurfaceOperation[];
  tags: RouteTag[];
  collisions: string[];
  confidence: 'proven' | 'heuristic';
  truncated?: true;
}

export interface SurfaceCollision {
  key: string;
  bucket: string;
  type: string;
  field: string;
  routes: string[];
}

export interface AttackSurface {
  version: 1;
  /** Hash da topologia de origem: a resposta da IA fica amarrada a este mapa. */
  topologyHash: string;
  routes: SurfaceRoute[];
  collisions: SurfaceCollision[];
}

/** `src/a.ts#decrement:10` → `decrement`. */
const symbolName = (id: string) => {
  const name = id.slice(id.indexOf('#') + 1);
  const colon = name.lastIndexOf(':');
  return colon > 0 ? name.slice(0, colon) : name;
};

export function attackSurface(topology: TopologyGraph): AttackSurface {
  return {
    version: 1,
    topologyHash: topology.contentHash,
    routes: topology.routes.filter(isSensitive).map((r) => ({
      id: r.id,
      method: r.method,
      path: r.path,
      at: `${r.file}:${r.line + 1}`,
      handlers: r.handlers.map((h) => h.label),
      operations: r.operations.map((o) => ({
        order: o.order,
        kind: o.kind,
        target: o.target,
        via: o.via,
        ...(o.operation && { operation: o.operation }),
        ...(o.lock && { lock: o.lock }),
        ...(o.timeout && { timeout: o.timeout }),
        at: `${o.file}:${o.line + 1}`,
        in: symbolName(o.symbol),
        confidence: o.confidence,
      })),
      tags: r.tags,
      collisions: r.collisions,
      confidence: r.confidence,
      ...(r.truncated && { truncated: r.truncated }),
    })),
    collisions: topology.collisions.map((c) => ({
      key: c.key,
      bucket: c.bucket,
      type: c.collision.type,
      field: c.collision.field,
      routes: c.routes,
    })),
  };
}
