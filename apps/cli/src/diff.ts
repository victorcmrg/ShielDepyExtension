// `shieldepy diff <pasta> --base <ref>`: o que o PR mudou na estrutura do código (E5), comparando o
// mapa da pasta agora com o mapa dela no merge-base com o ref.

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  affectedRoutes,
  buildSystemGraph,
  buildTopology,
  canonicalJson,
  CodeGraph,
  diffSystemGraphs,
  indexFiles,
  listSourceFiles,
  silentHost,
  type AffectedRoutes,
  type MapDiff,
  type SystemGraph,
  type TopologyGraph,
} from '@shieldepy/core';
import { renderGraphHtml } from '@shieldepy/viewer';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRulesFromPath, type Registry } from '@shieldepy/extractors';
import { GitBaseError, withBaseCheckout, type BaseInfo } from '@shieldepy/core';

interface DiffIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/** O mapa de uma pasta (grafo de código + regras), com ids relativos a ela. Pasta inexistente = mapa vazio. */
export async function buildMapOf(dir: string, registry: () => Promise<Registry>, wasmDir = defaultWasmDir()): Promise<{ graph: CodeGraph; system: SystemGraph }> {
  const graph = await CodeGraph.create(wasmDir, silentHost);
  if (!existsSync(dir)) return { graph, system: buildSystemGraph(graph, [], dir) };
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const { rules } = loadRulesFromPath(dir, await registry());
  return { graph, system: buildSystemGraph(graph, rules, dir) };
}

/** Mapa de agora × mapa da base, mais o que o git diz que mudou na pasta e as rotas que isso tocou. */
export async function diffAgainstBase(
  dir: string,
  ref: string,
  registry: () => Promise<Registry>
): Promise<{ diff: MapDiff; base: BaseInfo; head: SystemGraph; before: SystemGraph; topology: TopologyGraph; routes: AffectedRoutes }> {
  const now = await buildMapOf(dir, registry);
  const topology = buildTopology(now.graph, now.system, dir);
  return withBaseCheckout(dir, ref, async (baseDir, base) => {
    const before = await buildMapOf(baseDir, registry);
    const diff = diffSystemGraphs(before.system, now.system);
    const routes = affectedRoutes(buildTopology(before.graph, before.system, baseDir), topology, diff, base.changedFiles);
    return { diff, base, head: now.system, before: before.system, topology, routes };
  });
}

export async function runDiffCommand(args: { target: string; base: string; json: boolean; html?: string }, io: DiffIo, registry: () => Promise<Registry>): Promise<number> {
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
  const { diff, base, routes } = result;
  if (args.html) {
    await mkdir(path.dirname(path.resolve(args.html)), { recursive: true });
    const overlay = { diff: { base: args.base, commit: base.commit, diff, routes } };
    await writeFile(args.html, renderGraphHtml(result.head, path.basename(path.resolve(args.target)), { kind: 'inline' }, result.topology, overlay), 'utf8');
    io.err(`✓ visualizador (mapa + diff do PR) salvo em ${args.html}`);
  }
  if (args.json) {
    io.out(canonicalJson({ base: base.commit, changedFiles: base.changedFiles, diff, routes }, 2));
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
  io.out(`   arestas: +${diff.edges.added.length} / -${diff.edges.removed.length}`);
  if (routes.all) io.out(`   rotas tocadas: todas (${routes.all})`);
  else for (const r of routes.affected) io.out(`   rota tocada ${r.id}: ${r.why.join('; ')}`);
  io.out('');
  return 0;
}
