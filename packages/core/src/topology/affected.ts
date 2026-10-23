// Quais rotas um PR tocou (E5): só elas vão para a IA e para os testes de caos. O critério é
// conservador — na dúvida, a rota entra —, porque deixar de testar uma rota tocada é pior do que
// testar uma a mais.

import type { MapDiff } from '../map-diff';
import type { TopologyGraph, TopologyRoute } from './types';

export interface AffectedRoute {
  id: string;
  /** Por que entrou (para o relatório). */
  why: string[];
}

export interface AffectedRoutes {
  /** Todas as rotas entram (mudou config, dependência ou setup): o motivo. */
  all?: string;
  affected: AffectedRoute[];
  /** Rotas que existem agora e o PR não tocou. */
  untouched: string[];
}

/** Arquivos que mudam o comportamento de TODAS as rotas sem aparecer no grafo de chamadas. */
export function isGlobalChange(file: string, setupFiles: string[] = []): boolean {
  const base = file.split('/').pop() ?? file;
  if (setupFiles.includes(file)) return true;
  if (base === 'shieldepy.chaos.config.ts' || base === 'package.json' || base === 'package-lock.json' || base === 'npm-shrinkwrap.json') return true;
  if (base === 'yarn.lock' || base === 'pnpm-lock.yaml' || base === '.npmrc') return true;
  if (base.startsWith('tsconfig') && base.endsWith('.json')) return true;
  return /^(vite|vitest)\.config\.[cm]?[jt]s$/.test(base);
}

const fileOf = (symbolId: string) => symbolId.slice(0, symbolId.indexOf('#'));
const handlerSig = (r: TopologyRoute) => JSON.stringify(r.handlers.map((h) => [h.label, h.symbols]));
const opsSig = (r: TopologyRoute) =>
  JSON.stringify(r.operations.map((o) => [o.kind, o.target, o.via, o.operation ?? '', o.lock ?? false, o.timeout ?? '', o.symbol]));
const tagsSig = (r: TopologyRoute) => JSON.stringify(r.tags);

/**
 * Uma rota de agora entra se: é nova; a cadeia de handlers mudou; as operações ou as tags mudaram;
 * um símbolo do alcance dela (agora ou antes) mudou, sumiu, foi renomeado ou é novo; ou mudou o
 * código de topo de um arquivo do alcance (montagem, instância exportada) ou o de registro da rota.
 */
export function affectedRoutes(base: TopologyGraph, head: TopologyGraph, diff: MapDiff, changedFiles: string[], setupFiles: string[] = []): AffectedRoutes {
  const global = changedFiles.filter((f) => isGlobalChange(f, setupFiles));
  if (global.length > 0) {
    return { all: `mudou ${global.join(', ')} (vale para todas as rotas)`, affected: head.routes.map((r) => ({ id: r.id, why: ['mudança global'] })), untouched: [] };
  }
  const before = new Map(base.routes.map((r) => [r.id, r]));
  const touchedNow = new Set([...diff.symbols.changed, ...diff.symbols.added, ...diff.symbols.renamed.map((r) => r.to)]);
  const touchedBefore = new Set([...diff.symbols.changed, ...diff.symbols.removed, ...diff.symbols.renamed.map((r) => r.from)]);
  const topChanged = new Set(diff.files.topChanged);

  const affected: AffectedRoute[] = [];
  const untouched: string[] = [];
  for (const r of head.routes) {
    const old = before.get(r.id);
    const why: string[] = [];
    if (!old) why.push('rota nova');
    else {
      if (handlerSig(old) !== handlerSig(r)) why.push('a cadeia de handlers mudou');
      if (opsSig(old) !== opsSig(r)) why.push('as operações de I/O mudaram');
      else if (tagsSig(old) !== tagsSig(r)) why.push('as tags mudaram');
      const now = r.reach.filter((s) => touchedNow.has(s));
      const gone = old.reach.filter((s) => touchedBefore.has(s) && !now.includes(s));
      if (now.length + gone.length > 0) why.push(`código no caminho mudou: ${[...new Set([...now, ...gone])].join(', ')}`);
      const files = [...new Set([r.file, ...r.reach.map(fileOf)])].filter((f) => topChanged.has(f)).sort();
      if (files.length > 0) why.push(`o código de topo mudou em ${files.join(', ')}`);
    }
    if (why.length > 0) affected.push({ id: r.id, why });
    else untouched.push(r.id);
  }
  return { affected, untouched };
}
