import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  buildGraph,
  buildSystemGraph,
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
import { printCollisions, printCycles, printReport, printSystemGraph } from './print';
import { renderGraphHtml } from '@shieldepy/viewer';

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
}

const SEVERITY_ALIASES: Record<string, Severity> = { critico: 'Crítico', crítico: 'Crítico', alto: 'Alto', medio: 'Médio', médio: 'Médio', baixo: 'Baixo' };

export function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, pg: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--json') args.json = true;
    else if (a === '--pg') args.pg = true;
    else if (a === '--out' || a.startsWith('--out=') || a === '--html' || a.startsWith('--html=')) {
      const flag = a.startsWith('--out') ? 'out' : 'html';
      const value = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!value) throw new Error(`--${flag} precisa de um caminho de arquivo`);
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
        const cycles = graph.allCycles().map((c) => c.labels);
        if (args.json) io.out(JSON.stringify(cycles, null, 2));
        else printCycles(cycles, graph.stats, io.out);
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
