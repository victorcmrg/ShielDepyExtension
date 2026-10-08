// `shieldepy chaos <pasta>`: topologia → superfície de ataque → LangGraph (Threat Modeler +
// especialistas) → testes de caos gravados em `.shieldepy/chaos-tests/` → Vitest do projeto →
// portão. Exit 1 com achado válido (de severidade `--fail-on` ou pior); exit 2 quando o ambiente
// não deixou provar nada (Vitest ausente, sem relatório, todos os testes inválidos). Com
// `--no-run`, só gera os testes e o relatório de hipóteses. Com `--base <ref>` (E5), só as rotas
// sensíveis que o PR tocou vão para a IA e para os testes.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  affectedRoutes,
  attackSurface,
  buildSystemGraph,
  buildTopology,
  canonicalJson,
  diffSystemGraphs,
  CHAOS_CONFIG_FILE,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  readChaosConfig,
  silentHost,
  type AttackSurface,
  type MapDiff,
  type SystemGraph,
  type TopologyGraph,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { CostMeter, providerFromEnv, type Severity } from '@shieldepy/agent';
import {
  buildChaosResults,
  CATALOG,
  CHAOS_RESULTS_FILE,
  CHAOS_TESTS_DIR,
  chaosOutcomes,
  explainChaosOutcomes,
  gateHits,
  renderChaosReport,
  runChaosPipeline,
  type ChaosExplanation,
  type ChaosOutcome,
  type ChaosScope,
  type ChaosStateType,
  type TestResult,
} from '@shieldepy/agent/chaos';
import { loadRulesFromPath } from '@shieldepy/extractors';
import type { Registry } from '@shieldepy/extractors';
import { ChaosRunError, runChaosTests } from './chaos-run';
import { renderGraphHtml } from '@shieldepy/viewer';
import { buildMapOf } from './diff';
import { GitBaseError, withBaseCheckout } from '@shieldepy/core';

export interface ChaosArgs {
  target: string;
  json: boolean;
  noRun: boolean;
  offline: boolean;
  /** Portão: sai 1 com achado desta severidade ou pior. Padrão: qualquer achado. */
  failOn?: Severity;
  /** Grava o relatório markdown (para o `$GITHUB_STEP_SUMMARY` e o comentário do PR). */
  report?: string;
  /** Só as rotas que o PR tocou desde o merge-base com este ref (E5). */
  base?: string;
  /** Grava o visualizador do mapa com o resultado do caos (e o diff, com `--base`) por cima (V2). */
  html?: string;
}

/** Roda os testes gerados (o padrão é o Vitest do projeto; os testes da CLI injetam outro). */
export type ChaosTestRunner = (root: string, hypothesisIds: string[]) => Promise<TestResult[]>;

interface ChaosIoLike {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const VITE_CONFIGS = ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vite.config.ts', 'vite.config.mts', 'vite.config.js'];

const CONFIG_TEMPLATE = `export default {
  createApp,                       // monta o app sem abrir porta (supertest)
  setupFiles: ['chaos/setup.ts'],  // ex.: troca o banco por um em memória
  async reset() { /* estado limpo antes de cada teste */ },
  invariants: { async estoqueNuncaNegativo() { return true; } },
  apis: { 'api.exemplo.com': () => ({ ok: true }) },          // resposta saudável de cada API externa
  requests: { 'POST /checkout': { path: '/checkout', body: {} } }, // uma requisição válida por rota
};`;

export async function runChaosCommand(
  args: ChaosArgs,
  io: ChaosIoLike,
  registry: () => Promise<Registry>,
  runTests: ChaosTestRunner = runChaosTests
): Promise<number> {
  const root = path.resolve(args.target);
  const configPath = path.join(root, CHAOS_CONFIG_FILE);
  if (!existsSync(configPath)) {
    io.err(`erro: falta ${CHAOS_CONFIG_FILE} na raiz de ${args.target}.`);
    io.err('Ele diz como subir o app, zerar o estado, o que nunca pode acontecer e como é uma requisição válida:\n');
    io.err(CONFIG_TEMPLATE);
    return 2;
  }

  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(root), silentHost);
  const config = graph.tsParser?.withTree(await readFile(configPath, 'utf8'), false, readChaosConfig);
  if (!config) {
    io.err(`erro: ${CHAOS_CONFIG_FILE} não exporta um objeto de config (export default { ... }).`);
    return 2;
  }
  const { rules } = loadRulesFromPath(root, await registry());
  const system = buildSystemGraph(graph, rules, root);
  const topology = buildTopology(graph, system, root);
  const fullSurface = attackSurface(topology);

  // --base: só as rotas sensíveis que o PR tocou (o resto não vai para a IA nem para os testes)
  let scope: ChaosScope | undefined;
  let baseDiff: { base: string; commit: string; diff: MapDiff } | undefined;
  let surface = fullSurface;
  if (args.base) {
    try {
      ({ scope, diff: baseDiff } = await scopeAgainstBase(root, args.base, system, topology, fullSurface, config.setupFiles, registry));
    } catch (err) {
      if (!(err instanceof GitBaseError)) throw err;
      io.err(`erro: ${err.message}`);
      return 2;
    }
    const keep = new Set(scope.tested);
    surface = { ...fullSurface, routes: fullSurface.routes.filter((r) => keep.has(r.id)), collisions: fullSurface.collisions.filter((c) => c.routes.some((id) => keep.has(id))) };
    io.err(scope.all ? `escopo: todas as rotas (${scope.all})` : `escopo: ${scope.tested.length} de ${fullSurface.routes.length} rota(s) sensível(is) tocada(s) desde ${args.base}`);
  }

  const provider = args.offline ? undefined : providerFromEnv(io.env, io.err);
  // regera do zero: hipótese que sumiu não pode deixar um teste velho para trás
  await rm(path.join(root, CHAOS_TESTS_DIR), { recursive: true, force: true });
  const state = await runChaosPipeline(surface, {
    provider,
    invariantNames: config.invariants,
    log: io.err,
    render: {
      config,
      projectViteConfig: VITE_CONFIGS.find((f) => existsSync(path.join(root, f))),
      projectTsconfig: existsSync(path.join(root, 'tsconfig.json')) ? 'tsconfig.json' : undefined,
    },
    io: {
      write: async (files) => {
        for (const f of files) {
          const full = path.join(root, f.path);
          await mkdir(path.dirname(full), { recursive: true });
          await writeFile(full, f.content, 'utf8');
        }
      },
    },
  });

  // rodar: só as hipóteses que viraram arquivo de teste
  let outcomes: ChaosOutcome[] | undefined;
  let runError: string | undefined;
  const tested = state.specs.map((s) => s.hypothesisId);
  if (!args.noRun && tested.length > 0) {
    io.err(`rodando ${tested.length} teste(s) de caos com o Vitest do projeto (controle + caos)...`);
    try {
      outcomes = chaosOutcomes(await runTests(root, tested), state.hypotheses);
    } catch (err) {
      if (!(err instanceof ChaosRunError)) throw err;
      runError = err.message;
    }
  }
  const failOn = args.failOn ?? 'Baixo';
  const hits = outcomes ? gateHits(outcomes, failOn) : [];
  const allInvalid = !!outcomes && outcomes.length > 0 && outcomes.every((o) => o.status === 'invalid');

  // o parágrafo do relatório: da IA só com achado e provider; senão, do motor
  let explanation: ChaosExplanation | undefined;
  if (args.report && outcomes) explanation = await explainChaosOutcomes(outcomes, surface, { provider, log: io.err });

  const meter = new CostMeter();
  for (const c of [...state.completions, ...(explanation?.completion ? [explanation.completion] : [])]) meter.add(c);
  const cost = meter.report();

  if (args.report) {
    const markdown = renderChaosReport({
      label: path.basename(root),
      surface,
      hypotheses: state.hypotheses,
      outcomes,
      failOn,
      hits: hits.length,
      engine: state.engine,
      cost,
      runError,
      explanation,
      scope,
    });
    await mkdir(path.dirname(path.resolve(args.report)), { recursive: true });
    await writeFile(args.report, markdown, 'utf8');
    io.err(`✓ relatório salvo em ${args.report}`);
  }

  // o resultado fica em disco para o visualizador (CLI --html e o painel da extensão)
  const results = buildChaosResults({
    project: path.basename(root),
    topologyHash: fullSurface.topologyHash,
    engine: state.engine,
    hypotheses: state.hypotheses,
    outcomes,
    runError,
    failOn,
    hits: hits.length,
    scope,
    cost,
  });
  await mkdir(path.join(root, path.dirname(CHAOS_RESULTS_FILE)), { recursive: true });
  await writeFile(path.join(root, CHAOS_RESULTS_FILE), canonicalJson(results, 2) + '\n', 'utf8');
  if (args.html) {
    await mkdir(path.dirname(path.resolve(args.html)), { recursive: true });
    await writeFile(args.html, renderGraphHtml(system, path.basename(root), { kind: 'inline' }, topology, { chaos: results, ...(baseDiff && { diff: baseDiff }) }), 'utf8');
    io.err(`✓ visualizador (mapa + caos${baseDiff ? ' + diff do PR' : ''}) salvo em ${args.html}`);
  }

  if (args.json) {
    io.out(
      canonicalJson(
        {
          topologyHash: surface.topologyHash,
          engine: state.engine,
          summary: state.summary,
          hypotheses: state.hypotheses,
          rejected: state.rejected,
          specs: state.specs,
          written: state.written,
          warnings: state.warnings,
          errors: state.errors,
          cost,
          ...(scope ? { scope } : {}),
          ...(outcomes ? { results: outcomes, gate: { failOn, hits: hits.length } } : {}),
          ...(runError ? { runError } : {}),
        },
        2
      )
    );
  } else {
    if (scope) printScope(scope, io.out);
    printChaos(state, args.target, cost, io.out, args.noRun);
    if (outcomes) printOutcomes(outcomes, io.out);
  }

  if (runError) {
    io.err(`erro de ambiente: ${runError}`);
    return 2;
  }
  if (hits.length > 0) {
    io.err(`✖ portão: ${hits.length} achado(s) de caos${failOn === 'Baixo' ? '' : ` com severidade ${failOn} ou pior`}.`);
    return 1;
  }
  if (allInvalid) {
    io.err('erro de ambiente: nenhum teste de caos foi válido (todos os controles falharam ou não rodaram). Nada foi provado.');
    return 2;
  }
  return 0;
}

/** Monta a topologia da base e decide quais rotas sensíveis o PR tocou. */
async function scopeAgainstBase(
  root: string,
  ref: string,
  system: SystemGraph,
  topology: TopologyGraph,
  surface: AttackSurface,
  setupFiles: string[],
  registry: () => Promise<Registry>
): Promise<{ scope: ChaosScope; diff: { base: string; commit: string; diff: MapDiff } }> {
  return withBaseCheckout(root, ref, async (baseDir, info) => {
    const before = await buildMapOf(baseDir, registry);
    const baseTopology = buildTopology(before.graph, before.system, baseDir);
    const diff = diffSystemGraphs(before.system, system);
    const result = affectedRoutes(baseTopology, topology, diff, info.changedFiles, setupFiles);
    const sensitive = new Set(surface.routes.map((r) => r.id));
    const affected = result.affected.filter((a) => sensitive.has(a.id));
    const scope: ChaosScope = {
      base: ref,
      commit: info.commit,
      ...(result.all && { all: result.all }),
      tested: affected.map((a) => a.id),
      affected,
      untouched: result.untouched.filter((id) => sensitive.has(id)),
    };
    return { scope, diff: { base: ref, commit: info.commit, diff } };
  });
}

function printScope(scope: ChaosScope, out: (line: string) => void): void {
  out(`
🔀 escopo desde ${scope.base} (base ${scope.commit.slice(0, 10)}): ${scope.all ? `todas as rotas, porque ${scope.all}` : `${scope.tested.length} rota(s) sensível(is) tocada(s), ${scope.untouched.length} de fora`}`);
  if (!scope.all) for (const a of scope.affected) out(`   ● ${a.id}: ${a.why.join('; ')}`);
  if (scope.untouched.length > 0) out(`   ○ não tocadas (sem teste nesta execução): ${scope.untouched.join(', ')}`);
}

const STATUS_LABEL = { passed: '✓ aguentou', failed: '✖', invalid: '? inválido' } as const;

function printOutcomes(outcomes: ChaosOutcome[], out: (line: string) => void): void {
  const failed = outcomes.filter((o) => o.status === 'failed').length;
  const invalid = outcomes.filter((o) => o.status === 'invalid').length;
  out(`🔥 resultado: ${failed} achado(s), ${outcomes.length - failed - invalid} aguentou(aram), ${invalid} inválido(s)`);
  for (const o of outcomes) {
    const label = o.status === 'failed' ? `${STATUS_LABEL.failed} ${o.severity}` : STATUS_LABEL[o.status];
    const secs = (o.durationMs / 1000).toFixed(1).replace('.', ',');
    out(`   ${label.padEnd(11)} ${o.failure.padEnd(36)} ${o.routeId.padEnd(18)} ${o.target.padEnd(16)} ${secs} s`);
    if (o.message) out(`        ${o.status === 'invalid' ? 'não conta: ' : ''}${o.message}`);
  }
  out('');
}

function printChaos(state: ChaosStateType, label: string, cost: ReturnType<CostMeter['report']>, out: (line: string) => void, noRun: boolean): void {
  const engine = state.engine === 'offline' ? 'motor (offline)' : `IA (${state.engine})`;
  out(`\n🧪 caos de ${label} — hipóteses: ${engine}, topologia ${state.surface.topologyHash.slice(0, 16)}`);
  if (state.summary) out(`   ${state.summary}`);
  const files = new Map(state.specs.map((s) => [s.hypothesisId, s]));
  const testable = state.hypotheses.filter((h) => files.has(h.id));
  out(`\n   ${state.hypotheses.length} hipótese(s), ${testable.length} com teste gerado:`);
  for (const h of state.hypotheses) {
    const spec = files.get(h.id);
    const mark = spec ? '●' : '○';
    out(`   ${mark} P${h.priority} ${h.failure.padEnd(36)} ${h.routeId.padEnd(18)} ${h.target.padEnd(16)} ${h.source}`);
    out(`        ${h.rationale}`);
    if (!spec) {
      const entry = CATALOG.find((e) => e.id === h.failure);
      out(`        sem teste no MVP${entry?.agent === 'db_chaos' ? ' (precisa de falha injetada no banco: DB_Chaos, depois)' : ''}`);
    }
  }
  if (state.rejected.length > 0) {
    out(`\n   ${state.rejected.length} proposta(s) da IA descartada(s) na validação:`);
    for (const r of state.rejected) out(`     #${r.index}: ${r.reason}`);
  }
  if (state.warnings.length > 0) {
    out('\n⚠️  contrato incompleto (os testes afetados vão cair como inválidos):');
    for (const w of state.warnings) out(`   ${w}`);
  }
  if (state.errors.length > 0) {
    out('\n⚠️  a IA não ajudou em tudo (o motor completou):');
    for (const e of state.errors) out(`   ${e}`);
  }
  if (cost.calls > 0) {
    const usd = cost.usd.toFixed(4).replace('.', ',');
    const unpriced = cost.unpriced.length > 0 ? ` (sem preço tabelado: ${cost.unpriced.join(', ')})` : '';
    out(`\n💰 IA: ${cost.calls} chamada(s), ${cost.inputTokens} tokens de entrada, ${cost.outputTokens} de saída, ${cost.cacheReadTokens} lidos do cache → US$ ${usd}${unpriced}`);
  } else out('\n💰 IA: nenhuma chamada (custo zero)');
  const specs = state.written.filter((f) => f.endsWith('.spec.ts')).length;
  if (specs > 0) {
    out(`✓ ${specs} teste(s) de caos em ${CHAOS_TESTS_DIR}/`);
    if (noRun) out(`  rodar à mão: npx vitest run --config ${CHAOS_TESTS_DIR}/vitest.config.ts`);
    out('');
  } else out('nenhum teste gerado (nenhuma rota sensível com falha testável)\n');
}
