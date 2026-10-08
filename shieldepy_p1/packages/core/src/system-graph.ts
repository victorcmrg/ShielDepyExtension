// O mapa do sistema inteiro num artefato só: grafo de código (arquivos, símbolos, pacotes,
// imports, chamadas, referências) + grafo de interações (baldes recurso × evento e colisões) +
// cobertura. É o que a E2 (topologia) e os agentes consomem — nunca o código-fonte cru.
// Determinístico: mesma entrada → mesmo JSON, byte a byte (ids relativos, tudo ordenado, hash).

import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { CodeGraph } from './code-graph/CodeGraph';
import { isSymbolNode, type EdgeType, type GraphStats } from './code-graph/types';
import { findCollisions } from './interactions/detector';
import { buildGraph } from './interactions/graph';
import type { Collision, Rule } from './interactions/model';
import { toFileId } from './paths';

export const SYSTEM_GRAPH_VERSION = 1;

export interface SystemNode {
  /** Arquivo: caminho relativo (`src/app.ts`); símbolo: `src/app.ts#nome:linha`; pacote: `pkg:nome`. */
  id: string;
  kind: 'file' | 'package' | 'function' | 'class' | 'method' | 'selector';
  name: string;
  /** Símbolo: arquivo dono (id relativo). */
  file?: string;
  /** Linhas 0-based. */
  startLine?: number;
  endLine?: number;
  signature?: string;
  container?: string;
  extends?: string[];
  implements?: string[];
  fields?: Record<string, string[]>;
  returns?: string[];
  /** Arquivo citado por um import mas ainda não lido. */
  external?: boolean;
}

export interface SystemEdge {
  source: string;
  target: string;
  type: EdgeType;
  heuristic?: true;
}

export interface SystemRule {
  id: string;
  name: string;
  reads: string[];
  writes: string[];
  order?: number;
  source: string;
  location?: { file: string; line: number };
  /** Símbolo do grafo de código que implementa a regra (o handler) — liga os dois grafos. */
  symbol?: string;
}

export interface SystemBucket {
  key: string;
  resource: string;
  event: string;
  rules: SystemRule[];
}

export interface SystemGraph {
  version: typeof SYSTEM_GRAPH_VERSION;
  /** SHA-256 do conteúdo (sem o próprio campo) — muda se e só se o mapa mudar. */
  contentHash: string;
  stats: GraphStats & { files: number; symbols: number; packages: number; rules: number; collisions: number };
  nodes: SystemNode[];
  edges: SystemEdge[];
  buckets: SystemBucket[];
  collisions: Collision[];
  /** Arquivos onde o mapa ainda adivinha ou falha — onde olhar pra melhorar a cobertura. */
  weakSpots: Array<{ file: string; callsHeuristic: number; callsUnresolved: number; importsUnresolved: string[] }>;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON com chaves ordenadas — base do hash e da saída estável. */
export function canonicalJson(value: unknown, indent?: number): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort(byString)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, sort((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent);
}

/** Id do grafo (absoluto) → id portátil, relativo a `root` (`src/app.ts#nome:3`); pacote fica como está. */
export function relativeIds(root: string): (id: string) => string {
  const rootId = toFileId(root).replace(/\/$/, '');
  return (id) => {
    if (id.startsWith('pkg:')) return id;
    const [file, symbol] = id.split('#', 2) as [string, string | undefined];
    const r = path.posix.relative(rootId, file);
    const relFile = r === '' ? '.' : r;
    return symbol === undefined ? relFile : `${relFile}#${symbol}`;
  };
}

/**
 * Monta o mapa do sistema a partir do grafo de código já indexado e das regras extraídas.
 * `root` é a pasta analisada: todos os ids viram relativos a ela (o artefato não carrega a máquina).
 */
export function buildSystemGraph(graph: CodeGraph, rules: Rule[], root: string): SystemGraph {
  const rel = relativeIds(root);

  const snapshot = graph.toSnapshot();
  const nodes: SystemNode[] = snapshot.nodes.map(({ id, attributes: a }) => {
    if (a.kind === 'package') return { id, kind: 'package', name: a.name };
    if (!isSymbolNode(a)) return { id: rel(id), kind: 'file', name: path.posix.basename(rel(id)), ...(a.external && { external: true }) };
    return {
      id: rel(id),
      kind: a.kind,
      name: a.name,
      file: rel(a.file),
      startLine: a.startLine,
      endLine: a.endLine,
      signature: a.signature,
      container: a.container,
      extends: a.extends,
      implements: a.implements,
      fields: a.fields,
      returns: a.returns,
    };
  });
  const edges: SystemEdge[] = snapshot.edges.map((e) => ({
    source: rel(e.source),
    target: rel(e.target),
    type: e.attributes.type,
    ...(e.attributes.heuristic && { heuristic: true as const }),
  }));

  const interaction = buildGraph(rules);
  const buckets: SystemBucket[] = [...interaction.buckets.entries()].map(([key, list]) => ({
    key,
    resource: list[0]!.resource,
    event: list[0]!.event,
    rules: list.map((r) => {
      const fileId = r.location ? toFileId(r.location.file) : undefined;
      const symbol = fileId && r.location ? graph.getEnclosingSymbol(fileId, r.location.line)?.id : undefined;
      return {
        id: r.id,
        name: r.name,
        reads: [...r.reads].sort(byString),
        writes: [...r.writes].sort(byString),
        order: r.order,
        source: r.source,
        location: fileId && r.location ? { file: rel(fileId), line: r.location.line } : undefined,
        symbol: symbol ? rel(symbol) : undefined,
      };
    }),
  }));
  const collisions = findCollisions(interaction);

  const weakSpots = graph
    .files()
    .map((f) => ({ file: rel(f), ...graph.fileCoverage(f) }))
    .filter((c) => c.callsHeuristic + c.callsUnresolved + c.importsUnresolved.length > 0)
    .map(({ file, callsHeuristic, callsUnresolved, importsUnresolved }) => ({ file, callsHeuristic, callsUnresolved, importsUnresolved }))
    .sort((a, b) => byString(a.file, b.file));

  nodes.sort((a, b) => byString(a.id, b.id));
  edges.sort((a, b) => byString(a.source, b.source) || byString(a.target, b.target) || byString(a.type, b.type));
  buckets.sort((a, b) => byString(a.key, b.key));

  const body = {
    version: SYSTEM_GRAPH_VERSION,
    stats: {
      ...graph.stats,
      files: nodes.filter((n) => n.kind === 'file' && !n.external).length,
      symbols: nodes.filter((n) => n.kind !== 'file' && n.kind !== 'package').length,
      packages: nodes.filter((n) => n.kind === 'package').length,
      rules: rules.length,
      collisions: collisions.length,
    },
    nodes,
    edges,
    buckets,
    collisions,
    weakSpots,
  };
  const contentHash = createHash('sha256').update(canonicalJson(body)).digest('hex');
  return { ...body, contentHash } as SystemGraph;
}
