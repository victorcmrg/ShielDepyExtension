// O valor que chega a um parâmetro sem tipo: `function save(db) { db.order.create() }` chamada com o cliente
// do banco. O receptor não diz o pacote, então quem diz é quem chama, seguindo os repasses (`deeper(db)`).

import type { CodeGraph } from '../code-graph/CodeGraph';
import { packageNodeId, type CallArg, type CallSite } from '../code-graph/types';
import { declaringFunction } from './routes';

/** O pacote de um parâmetro; `heuristic` quando nem tudo o que chega a ele foi provado. */
export interface ParamValue {
  package: string;
  heuristic: boolean;
}

/** Passadas, no máximo: uma por salto de repasse. Passou disso, o valor fica sem prova, não sem resposta. */
const MAX_PASSES = 16;

const PRISMA = '@prisma/client';

const paramKey = (fn: string, index: number) => `${fn}#${index}`;

/** O que um argumento passa: o pacote do valor, ou o parâmetro de quem chama (o valor vem de mais longe). */
function valueOf(arg: CallArg | undefined, site: CallSite, known: Map<string, ParamValue>): ParamValue | undefined {
  if (arg?.kind !== 'name' || arg.chain.length !== 1) return undefined;
  const heuristic = site.outcome === 'heuristic';
  if (arg.valuePackage) return { package: arg.valuePackage, heuristic };
  if (arg.param === undefined) return undefined;
  const repassed = known.get(paramKey(arg.origin?.owner ?? site.caller, arg.param));
  return repassed && { package: repassed.package, heuristic: heuristic || repassed.heuristic };
}

/**
 * Diz o pacote do receptor de uma chamada, quando ele é um parâmetro. Provado só se toda chamada à função
 * passa esse valor; com um chamador sem prova, sai `heuristic`; com dois pacotes, não se escolhe.
 * Sem nenhum chamador que diga, sobra o nome: `prisma.order.create()` num projeto com o Prisma, sempre `heuristic`.
 * Cada passada lê só a anterior, então a resposta não depende da ordem de indexação.
 */
export function paramValues(graph: CodeGraph, sites: CallSite[]): (site: CallSite) => ParamValue | undefined {
  const callsTo = new Map<string, CallSite[]>();
  const wanted = new Set<string>();
  const param = new Map<string, { fn: string; index: number }>();
  const want = (fn: string, index: number) => {
    const key = paramKey(fn, index);
    wanted.add(key);
    param.set(key, { fn, index });
  };
  for (const site of sites) {
    if (site.receiverParam !== undefined && !site.receiverInCallback) want(declaringFunction(site), site.receiverParam);
    for (const arg of site.args) if (arg.kind === 'name' && arg.param !== undefined) want(arg.origin?.owner ?? site.caller, arg.param);
    if (site.outcome !== 'resolved' && site.outcome !== 'heuristic') continue;
    for (const target of site.targets) {
      const list = callsTo.get(target);
      if (list) list.push(site);
      else callsTo.set(target, [site]);
    }
  }

  let known = new Map<string, ParamValue>();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const next = new Map<string, ParamValue>();
    for (const key of wanted) {
      const { fn, index } = param.get(key)!;
      const incoming = (callsTo.get(fn) ?? []).map((site) => valueOf(site.args[index], site, known));
      const values = incoming.filter((v): v is ParamValue => !!v);
      const packages = new Set(values.map((v) => v.package));
      if (packages.size !== 1) continue;
      next.set(key, { package: values[0]!.package, heuristic: values.length < incoming.length || values.some((v) => v.heuristic) });
    }
    const stable = next.size === known.size && [...next].every(([k, v]) => known.get(k)?.package === v.package && known.get(k)?.heuristic === v.heuristic);
    known = next;
    if (stable) break;
  }

  const hasPrisma = !!graph.nodeAttributes(packageNodeId(PRISMA));
  return (site) => {
    if (site.receiverParam === undefined || site.outcome === 'external' || site.outcome === 'resolved') return undefined;
    const value = site.receiverInCallback ? undefined : known.get(paramKey(declaringFunction(site), site.receiverParam));
    if (value) return value;
    return hasPrisma && site.object?.length === 2 && site.object[0] === 'prisma' ? { package: PRISMA, heuristic: true } : undefined;
  };
}
