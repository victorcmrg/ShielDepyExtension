import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  attackSurface,
  buildGraph,
  buildSystemGraph,
  buildTopology,
  canonicalJson,
  CodeGraph,
  findCollisions,
  indexFiles,
  listSourceFiles,
  silentHost,
  type Rule,
} from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry, loadRulesFromPath, type Registry } from '@shieldepy/extractors';
import { explainCollisions, explainOffline, providerFromEnv, severityRank, type Severity } from '@shieldepy/agent';
import { printCollisions, printCycles, printReport, printSystemGraph, printTopology } from './print';
import { renderGraphHtml } from '@shieldepy/viewer';
import { runChaosCommand } from './chaos';
import { runDiffCommand } from './diff';
import { runPublishCommand } from './publish';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
}

const USAGE = `uso:
  shieldepy report  <pasta|arquivo|fixture.json> [--json] [--fail-on <Crítico|Alto|Médio|Baixo>]
  shieldepy explain <pasta|arquivo|fixture.json> [--json] [--fail-on <...>]
  shieldepy report  --pg [postgres://...]            (ou DATABASE_URL)
  shieldepy cycles  <pasta> [--json]                 ciclos de chamada entre funções/arquivos (TS/JS)
  shieldepy graph   <pasta> [--json] [--out <arquivo>] [--html <arquivo>]
                                                     mapa do sistema: código + regras + cobertura
                                                     (--html gera um visualizador interativo, offline)
  shieldepy topology <pasta> [--json] [--surface] [--out <arquivo>] [--html <arquivo>]
                                                     rotas Express, operações de I/O em ordem e tags de risco
                                                     (--surface: só o recorte que vai para a IA)
  shieldepy diff    <pasta> --base <ref> [--json] [--html <arquivo>]
                                                     o que mudou na estrutura do código desde o merge-base com <ref>
                                                     (símbolos novos/removidos/renomeados/com corpo alterado, topo dos arquivos, arestas)
  shieldepy chaos   <pasta> [--offline] [--fail-on <...>] [--report <arquivo.md>] [--base <ref>] [--html <arquivo>] [--no-run] [--json]
  shieldepy chaos   <pasta> --init                   cria o shieldepy.chaos.config.ts a partir do mapa (rotas e APIs preenchidas)
                                                     gera testes de caos para as rotas sensíveis em
                                                     .shieldepy/chaos-tests/ (precisa de shieldepy.chaos.config.ts),
                                                     roda com o Vitest do projeto e serve de portão:
                                                     exit 1 = achado (--fail-on; padrão: qualquer um),
                                                     exit 2 = o ambiente não deixou provar nada;
                                                     --offline: só o motor, sem IA (custo zero);
                                                     --report: relatório markdown (resumo do CI / comentário do PR);
                                                     --base: só as rotas que o PR tocou desde o merge-base com <ref>;
                                                     --html: mapa com o resultado (e o diff do PR) por cima;
                                                     --no-run: só gera os testes
  shieldepy publish <pasta> --portal <url> [--append-link <relatório.md>]
                                                     manda o último resultado do caos para o portal (token em
                                                     SHIELDEPY_PORTAL_TOKEN); --append-link põe o link no relatório

  report  = só o motor (determinístico, sem rede)
  explain = motor + IA (ANTHROPIC_API_KEY ou GEMINI_API_KEY); sem chave, explicador offline
  --fail-on = portão de CI: sai com código 1 se houver colisão dessa severidade ou pior`;

interface Args {
  command?: string;
  target?: string;
  json: boolean;
  pg: boolean;
  failOn?: Severity;
  out?: string;
  html?: string;
  report?: string;
  base?: string;
  portal?: string;
  appendLink?: string;
  surface: boolean;
  noRun: boolean;
  offline: boolean;
  init: boolean;
}

const SEVERITY_ALIASES: Record<string, Severity> = { critico: 'Crítico', crítico: 'Crítico', alto: 'Alto', medio: 'Médio', médio: 'Médio', baixo: 'Baixo' };

export function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, pg: false, surface: false, noRun: false, offline: false, init: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') args.json = true;
    else if (a === '--pg') args.pg = true;
    else if (a === '--surface') args.surface = true;
    else if (a === '--no-run') args.noRun = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--init') args.init = true;
    else if (['--out', '--html', '--report', '--base', '--portal', '--append-link'].some((f) => a === f || a.startsWith(`${f}=`))) {
      const flag = a.startsWith('--out') ? 'out' : a.startsWith('--html') ? 'html' : a.startsWith('--base') ? 'base' : a.startsWith('--portal') ? 'portal' : a.startsWith('--append-link') ? 'appendLink' : 'report';
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!value) throw new Error(flag === 'base' ? '--base precisa de um ref do git (ex.: origin/main)' : flag === 'portal' ? '--portal precisa do endereço do portal' : `--${flag} precisa de um caminho de arquivo`);
      args[flag] = value;
    }
    else if (a === '--fail-on' || a.startsWith('--fail-on=')) {
      const value = a.includes('=') ? a.split('=')[1]! : argv[++i];
      const sev = value ? SEVERITY_ALIASES[value.toLowerCase()] : undefined;
      if (!sev) throw new Error(`--fail-on inválido: "${value ?? ''}"`);
      args.failOn = sev;
    } else if (!args.command) args.command = a;
    else if (!args.target) args.target = a;
    else throw new Error(`argumento inesperado: ${a}`);
  }
  return args;
}

async function registryWithTreeSitter(): Promise<Registry> {
  // Gramática que não carregar só tira a sua linguagem (o arquivo sai como ignorado).
  return loadRegistry(defaultWasmDir());
}

async function loadRules(args: Args, io: Io): Promise<{ label: string; rules: Rule[] }> {
  if (args.pg) {
    const { loadRulesFromPostgres } = await import('@shieldepy/extractors/postgres-connect');
    const url = args.target ?? io.env.DATABASE_URL;
    if (!url) throw new Error('informe a URL do Postgres (argumento ou DATABASE_URL)');
    const rules = await loadRulesFromPostgres(url);
    return { label: `Postgres (${rules.length} regra(s))`, rules };
  }
  if (!args.target) throw new Error('informe a pasta ou o arquivo a analisar');
  const loaded = loadRulesFromPath(args.target, await registryWithTreeSitter());
  for (const s of loaded.skipped) io.err(`ignorado: ${s}`);
  return loaded;
}

/** Roda a CLI e devolve o código de saída. Sem `process.exit` — testável. */
export async function main(argv: string[], io: Io = { out: console.log, err: console.error, env: process.env }): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.err(`${err instanceof Error ? err.message : err}\n\n${USAGE}`);
    return 2;
  }

  try {
    switch (args.command) {
      case 'report':
      case 'explain': {
        const { label, rules } = await loadRules(args, io);
        const collisions = findCollisions(buildGraph(rules));
        const report =
          args.command === 'explain'
            ? await explainCollisions(collisions, rules, providerFromEnv(io.env, io.err), { log: io.err })
            : explainOffline(collisions, rules);
        if (args.json) io.out(JSON.stringify({ label, rules: rules.length, collisions, report }, null, 2));
        else if (args.command === 'explain') printReport(report, label, io.out);
        else printCollisions(collisions, rules, label, io.out);
        return gate(args.failOn, report.diagnoses.map((d) => d.severity), io);
      }
      case 'cycles': {
        if (!args.target) throw new Error('informe a pasta');
        const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
        await indexFiles(graph, await listSourceFiles(args.target), silentHost);
        // entre arquivos é acoplamento (barra com --fail-on); no mesmo arquivo é recursão, só informa
        const all = graph.allCycles();
        const cycles = all.filter((c) => !c.recursion).map((c) => c.labels);
        if (args.json) io.out(JSON.stringify(cycles, null, 2));
        else printCycles(cycles, all.filter((c) => c.recursion).map((c) => c.labels), graph.stats, io.out);
        return args.failOn && cycles.length > 0 ? 1 : 0;
      }
      case 'graph': {
        if (!args.target) throw new Error('informe a pasta');
        const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
        await indexFiles(graph, await listSourceFiles(args.target), silentHost);
        const { rules } = loadRulesFromPath(args.target, await registryWithTreeSitter());
        const system = buildSystemGraph(graph, rules, args.target);
        if (args.out) {
          await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
          await writeFile(args.out, canonicalJson(system, 2) + '\n', 'utf8');
          io.err(`✓ mapa salvo em ${args.out}`);
        }
        if (args.html) {
          await mkdir(path.dirname(path.resolve(args.html)), { recursive: true });
          await writeFile(args.html, renderGraphHtml(system, args.target), 'utf8');
          io.err(`✓ visualizador salvo em ${args.html} (abra no navegador)`);
        }
        if (args.json) io.out(canonicalJson(system, 2));
        else printSystemGraph(system, args.target, io.out);
        return 0;
      }
      case 'topology': {
        if (!args.target) throw new Error('informe a pasta');
        const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
        await indexFiles(graph, await listSourceFiles(args.target), silentHost);
        const { rules } = loadRulesFromPath(args.target, await registryWithTreeSitter());
        const system = buildSystemGraph(graph, rules, args.target);
        const topology = buildTopology(graph, system, args.target);
        const result = args.surface ? attackSurface(topology) : topology;
        if (args.out) {
          await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
          await writeFile(args.out, canonicalJson(result, 2) + '\n', 'utf8');
          io.err(`✓ ${args.surface ? 'superfície de ataque' : 'topologia'} salva em ${args.out}`);
        }
        if (args.html) {
          await mkdir(path.dirname(path.resolve(args.html)), { recursive: true });
          await writeFile(args.html, renderGraphHtml(system, args.target, { kind: 'inline' }, topology), 'utf8');
          io.err(`✓ visualizador (mapa + rotas) salvo em ${args.html} (abra no navegador)`);
        }
        if (args.json) io.out(canonicalJson(result, 2));
        else printTopology(topology, args.target, io.out);
        return 0;
      }
      case 'diff': {
        if (!args.target) throw new Error('informe a pasta');
        if (!args.base) throw new Error('informe o ref base: --base origin/main');
        return await runDiffCommand({ target: args.target, base: args.base, json: args.json, html: args.html }, io, registryWithTreeSitter);
      }
      case 'publish': {
        if (!args.target) throw new Error('informe a pasta do projeto');
        return await runPublishCommand({ target: args.target, portal: args.portal, appendLink: args.appendLink }, io);
      }
      case 'chaos': {
        if (!args.target) throw new Error('informe a pasta do projeto');
        return await runChaosCommand({ target: args.target, json: args.json, noRun: args.noRun, offline: args.offline, failOn: args.failOn, report: args.report, base: args.base, html: args.html, init: args.init }, io, registryWithTreeSitter);
      }
      default:
        io.err(USAGE);
        return args.command ? 2 : 0;
    }
  } catch (err) {
    io.err(`erro: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
}

function gate(failOn: Severity | undefined, severities: Severity[], io: Io): number {
  if (!failOn) return 0;
  const hit = severities.filter((s) => severityRank(s) <= severityRank(failOn)).length;
  if (hit > 0) io.err(`✖ portão: ${hit} colisão(ões) com severidade ${failOn} ou pior.`);
  return hit > 0 ? 1 : 0;
}
