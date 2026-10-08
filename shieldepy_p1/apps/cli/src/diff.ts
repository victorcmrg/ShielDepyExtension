// `shieldepy diff <pasta> --base <ref>`: o que o PR mudou na estrutura do código (E5), comparando o
// mapa da pasta agora com o mapa dela no merge-base com o ref.

import { existsSync } from 'node:fs';
import { buildSystemGraph, canonicalJson, CodeGraph, diffSystemGraphs, indexFiles, listSourceFiles, silentHost, type MapDiff, type SystemGraph } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRulesFromPath, type Registry } from '@shieldepy/extractors';
import { GitBaseError, withBaseCheckout, type BaseInfo } from './git-base';

interface DiffIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** O mapa de uma pasta (grafo de código + regras), com ids relativos a ela. Pasta inexistente = mapa vazio. */
export async function buildMapOf(dir: string, registry: () => Promise<Registry>): Promise<{ graph: CodeGraph; system: SystemGraph }> {
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  if (!existsSync(dir)) return { graph, system: buildSystemGraph(graph, [], dir) };
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const { rules } = loadRulesFromPath(dir, await registry());
  return { graph, system: buildSystemGraph(graph, rules, dir) };
}

/** Mapa de agora × mapa da base, mais o que o git diz que mudou na pasta. */
export async function diffAgainstBase(dir: string, ref: string, registry: () => Promise<Registry>): Promise<{ diff: MapDiff; base: BaseInfo; head: SystemGraph; before: SystemGraph }> {
  const head = (await buildMapOf(dir, registry)).system;
  return withBaseCheckout(dir, ref, async (baseDir, base) => {
    const before = (await buildMapOf(baseDir, registry)).system;
    return { diff: diffSystemGraphs(before, head), base, head, before };
  });
}

export async function runDiffCommand(args: { target: string; base: string; json: boolean }, io: DiffIo, registry: () => Promise<Registry>): Promise<number> {
  let result;
  try {
    result = await diffAgainstBase(args.target, args.base, registry);
  } catch (err) {
    if (err instanceof GitBaseError) {
      io.err(`erro: ${err.message}`);
      return 2;
    }
    throw err;
  }
  const { diff, base } = result;
  if (args.json) {
    io.out(canonicalJson({ base: base.commit, changedFiles: base.changedFiles, diff }, 2));
    return 0;
  }
  io.out(`\n🔀 ${args.target} desde ${args.base} (base ${base.commit.slice(0, 10)}): ${base.changedFiles.length} arquivo(s) alterado(s) no git`);
  if (diff.empty) {
    io.out('   nenhuma mudança de estrutura (só comentário, espaço ou linhas deslocadas, ou arquivos fora do mapa)\n');
    return 0;
  }
  const list = (title: string, items: string[]) => {
    if (items.length === 0) return;
    io.out(`   ${title} (${items.length}):`);
    for (const i of items.slice(0, 40)) io.out(`     ${i}`);
    if (items.length > 40) io.out(`     … e mais ${items.length - 40}`);
  };
  list('símbolos novos', diff.symbols.added);
  list('símbolos removidos', diff.symbols.removed);
  list('corpo alterado', diff.symbols.changed);
  list('renomeados', diff.symbols.renamed.map((r) => `${r.from} → ${r.to}`));
  list('arquivos novos', diff.files.added);
  list('arquivos removidos', diff.files.removed);
  list('código de topo alterado', diff.files.topChanged);
  io.out(`   arestas: +${diff.edges.added.length} / -${diff.edges.removed.length}\n`);
  return 0;
}
