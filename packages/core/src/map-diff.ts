// Diff entre dois mapas do sistema (E5): o que um PR mudou na estrutura do código. É operação de
// conjunto sobre ids estáveis (`arquivo#Contêiner.nome`), não isomorfismo de grafo: o mesmo id nos
// dois lados é o mesmo símbolo; o corpo mudou se o `bodyHash` mudou; e um símbolo que sumiu e outro
// que apareceu no MESMO arquivo, com o mesmo corpo e o mesmo tipo, é uma renomeação.

import type { SystemGraph, SystemNode } from './system-graph';

export interface SymbolRename {
  from: string;
  to: string;
}

export interface MapDiff {
  symbols: {
    added: string[];
    removed: string[];
    /** Mesmo id, corpo diferente. */
    changed: string[];
    renamed: SymbolRename[];
  };
  files: {
    added: string[];
    removed: string[];
    /** O código de topo (fora dos símbolos) mudou: imports, montagem, instância exportada. */
    topChanged: string[];
  };
  /** `origem -tipo-> alvo`, com as renomeações já aplicadas ao lado base (renomear não vira ruído). */
  edges: { added: string[]; removed: string[] };
  /** Nada mudou na estrutura (só comentário, espaço ou linhas deslocadas). */
  empty: boolean;
}

const isSymbol = (n: SystemNode) => n.kind === 'function' || n.kind === 'class' || n.kind === 'method' || n.kind === 'selector';
const isFile = (n: SystemNode) => n.kind === 'file' && !n.external;
const edgeKey = (source: string, type: string, target: string) => `${source} -${type}-> ${target}`;

export function diffSystemGraphs(base: SystemGraph, head: SystemGraph): MapDiff {
  const baseSyms = new Map(base.nodes.filter(isSymbol).map((n) => [n.id, n]));
  const headSyms = new Map(head.nodes.filter(isSymbol).map((n) => [n.id, n]));

  let removed = [...baseSyms.keys()].filter((id) => !headSyms.has(id)).sort();
  let added = [...headSyms.keys()].filter((id) => !baseSyms.has(id)).sort();
  const changed = [...baseSyms.keys()].filter((id) => headSyms.has(id) && baseSyms.get(id)!.bodyHash !== headSyms.get(id)!.bodyHash).sort();

  // renomeação: mesmo arquivo, mesmo tipo, mesmo corpo — par a par, na ordem dos ids
  const renamed: SymbolRename[] = [];
  const taken = new Set<string>();
  for (const from of removed) {
    const a = baseSyms.get(from)!;
    if (!a.bodyHash) continue;
    const to = added.find((id) => {
      const b = headSyms.get(id)!;
      return !taken.has(id) && b.file === a.file && b.kind === a.kind && b.bodyHash === a.bodyHash;
    });
    if (to) {
      taken.add(to);
      renamed.push({ from, to });
    }
  }
  const renamedFrom = new Set(renamed.map((r) => r.from));
  removed = removed.filter((id) => !renamedFrom.has(id));
  added = added.filter((id) => !taken.has(id));

  const baseFiles = new Map(base.nodes.filter(isFile).map((n) => [n.id, n]));
  const headFiles = new Map(head.nodes.filter(isFile).map((n) => [n.id, n]));
  const files = {
    added: [...headFiles.keys()].filter((id) => !baseFiles.has(id)).sort(),
    removed: [...baseFiles.keys()].filter((id) => !headFiles.has(id)).sort(),
    topChanged: [...baseFiles.keys()].filter((id) => headFiles.has(id) && baseFiles.get(id)!.topHash !== headFiles.get(id)!.topHash).sort(),
  };

  const rename = new Map(renamed.map((r) => [r.from, r.to]));
  const as = (id: string) => rename.get(id) ?? id;
  const baseEdges = new Set(base.edges.map((e) => edgeKey(as(e.source), e.type, as(e.target))));
  const headEdges = new Set(head.edges.map((e) => edgeKey(e.source, e.type, e.target)));
  const edges = {
    added: [...headEdges].filter((e) => !baseEdges.has(e)).sort(),
    removed: [...baseEdges].filter((e) => !headEdges.has(e)).sort(),
  };

  const symbols = { added, removed, changed, renamed };
  const empty =
    added.length + removed.length + changed.length + renamed.length + files.added.length + files.removed.length + files.topChanged.length + edges.added.length + edges.removed.length === 0;
  return { symbols, files, edges, empty };
}
