// `shieldepy chaos <pasta>`: topologia → superfície de ataque → LangGraph (Threat Modeler +
// especialistas) → testes de caos gravados em `.shieldepy/chaos-tests/`. Rodar os testes e
// bloquear o PR é a E4; aqui o comando gera e relata (com o custo da IA e o hash da topologia).

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  attackSurface,
  buildSystemGraph,
  buildTopology,
  canonicalJson,
  CHAOS_CONFIG_FILE,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  readChaosConfig,
  silentHost,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { CostMeter, providerFromEnv } from '@shieldepy/agent';
import { CATALOG, CHAOS_TESTS_DIR, runChaosPipeline, type ChaosStateType } from '@shieldepy/agent/chaos';
import { loadRulesFromPath } from '@shieldepy/extractors';
import type { Registry } from '@shieldepy/extractors';

export interface ChaosArgs {
  target: string;
  json: boolean;
  noRun: boolean;
  offline: boolean;
}

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

export async function runChaosCommand(args: ChaosArgs, io: ChaosIoLike, registry: () => Promise<Registry>): Promise<number> {
  const root = path.resolve(args.target);
  const configPath = path.join(root, CHAOS_CONFIG_FILE);
  if (!existsSync(configPath)) {
    io.err(`erro: falta ${CHAOS_CONFIG_FILE} na raiz de ${args.target}.`);
    io.err('Ele diz como subir o app, zerar o estado, o que nunca pode acontecer e como é uma requisição válida:\n');
    io.err(CONFIG_TEMPLATE);
    return 2;
  }
  if (!args.noRun) {
    io.err('erro: rodar os testes de caos e bloquear o PR chega na E4. Por enquanto use --no-run (gera os testes e o relatório).');
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
  const topology = buildTopology(graph, buildSystemGraph(graph, rules, root), root);
  const surface = attackSurface(topology);

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

  const meter = new CostMeter();
  for (const c of state.completions) meter.add(c);
  const cost = meter.report();

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
        },
        2
      )
    );
  } else printChaos(state, args.target, cost, io.out);
  return 0;
}

function printChaos(state: ChaosStateType, label: string, cost: ReturnType<CostMeter['report']>, out: (line: string) => void): void {
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
    out(`  rodar (até a E4): npx vitest run --config ${CHAOS_TESTS_DIR}/vitest.config.ts\n`);
  } else out('nenhum teste gerado (nenhuma rota sensível com falha testável)\n');
}
