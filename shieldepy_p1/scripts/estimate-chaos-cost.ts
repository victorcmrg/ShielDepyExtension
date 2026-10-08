// Estimativa do custo da IA no pipeline de caos, SEM chamada paga (E5/5e). Roda o pipeline de
// verdade nos exemplos com um provider que grava cada requisição — o system e a mensagem reais, o
// tier e o max_tokens — e devolve uma resposta válida do tamanho de uma resposta real, para o fluxo
// seguir igual (Threat Modeler → especialistas → parágrafo do relatório). Os tokens saem dos
// caracteres, com uma faixa (o tokenizador real só a API tem: para o número exato, use
// `npm run measure:chaos -- --sim-gastar`).
//
//   npm run estimate:chaos            → tabela no terminal + .shieldepy/estimate-chaos-cost.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attackSurface,
  buildSystemGraph,
  buildTopology,
  CHAOS_CONFIG_FILE,
  CodeGraph,
  indexFiles,
  listSourceFiles,
  readChaosConfig,
  silentHost,
} from '../packages/core/src/index';
import { defaultWasmDir } from '../packages/core/src/wasm-path';
import type { CompletionRequest, LLMProvider } from '../packages/agent/src/provider';
import { chaosOutcomes, explainChaosOutcomes, runChaosPipeline, type TestResult } from '../packages/agent/src/chaos/index';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Caracteres por token: ~3,5 em português + JSON; a faixa cobre o erro da aproximação. */
const CHARS_PER_TOKEN = { central: 3.5, low: 4.2, high: 2.8 };

type Node = 'threat_modeler' | 'especialista' | 'relatorio';
interface CallRecord {
  example: string;
  node: Node;
  tier: 'fast' | 'deep';
  maxTokens: number;
  systemChars: number;
  userChars: number;
  outputChars: number;
}

/** Resposta plausível do tamanho de uma resposta real, sempre no formato que o nó valida. */
function cannedResponse(req: CompletionRequest): { node: Node; text: string } {
  const user = req.messages[0]!.content;
  if (req.system.includes('Threat Modeler')) {
    const surface = JSON.parse(user.slice(user.indexOf('{')));
    const hypotheses = [];
    for (const r of surface.routes) {
      for (const op of r.operations as { kind: string; target: string; in: string }[]) {
        if (op.kind === 'api_call') {
          for (const failure of ['timeout', 'http_5xx_intermittent', 'malformed_response']) {
            hypotheses.push({
              routeId: r.id,
              failure,
              target: op.target,
              priority: failure === 'timeout' ? 1 : 3,
              rationale: `${r.id} chama ${op.target} em ${op.in} sem proteção suficiente; sob ${failure} a rota pode ficar pendurada ou gravar estado parcial, porque as escritas seguintes dependem da resposta da API.`,
            });
          }
        }
      }
      const tables = new Set((r.operations as { kind: string; target: string }[]).filter((o) => o.kind === 'db_write').map((o) => o.target));
      for (const t of tables) {
        hypotheses.push({
          routeId: r.id,
          failure: 'race_condition',
          target: t,
          priority: 1,
          rationale: `${r.id} lê ${t}, espera a API externa e só depois grava ${t}, sem transação nem trava: duas requisições simultâneas veem o mesmo valor e o invariante quebra.`,
        });
      }
    }
    const summary =
      'A superfície tem rotas que leem e gravam a mesma tabela com uma chamada externa no meio, sem transação e sem timeout. As falhas de maior impacto são a corrida no estoque e a API externa lenta. Respostas 5xx e corpos inválidos completam o quadro.';
    return { node: 'threat_modeler', text: JSON.stringify({ summary, hypotheses }) };
  }
  if (req.system.includes('especialista')) {
    const input = JSON.parse(user) as { default: { kind: string; fault?: { mode: string; delayMs?: number; status?: number; body?: string }; parallel?: number; expect: unknown[] } };
    const d = input.default;
    const param =
      d.kind === 'concurrency'
        ? { parallel: d.parallel }
        : d.fault?.mode === 'delay'
          ? { delayMs: d.fault.delayMs }
          : d.fault?.mode === 'status'
            ? { status: d.fault.status }
            : { body: d.fault?.body };
    return {
      node: 'especialista',
      text: JSON.stringify({ ...param, expect: d.expect, why: 'O cliente não pode ficar sem resposta nem ver estado inconsistente quando a dependência falha.' }),
    };
  }
  return {
    node: 'relatorio',
    text: JSON.stringify({
      paragraph:
        'O checkout lê o estoque, espera a cobrança no Stripe e só depois grava, sem transação nem trava: duas compras simultâneas do último item passam pela leitura antes de qualquer escrita, e o estoque fica negativo. A correção típica é reservar com um UPDATE condicional (WHERE quantity >= $2) antes de cobrar, devolvendo a reserva se a cobrança falhar. A chamada ao Stripe não tem timeout e não trata resposta inválida: com a API lenta ou fora do ar, a rota fica pendurada. Use AbortSignal.timeout, valide o corpo e responda 502.',
    }),
  };
}

const calls: CallRecord[] = [];
function recorder(example: string): LLMProvider {
  const complete = async (req: CompletionRequest) => {
    const { node, text } = cannedResponse(req);
    calls.push({ example, node, tier: req.tier, maxTokens: req.maxTokens, systemChars: req.system.length, userChars: req.messages.reduce((n, m) => n + m.content.length, 0), outputChars: text.length });
    return text;
  };
  return { name: 'anthropic', complete, completeWithUsage: async (req) => ({ text: await complete(req), model: 'estimativa' }) };
}

// os 4 achados medidos no vulnerável (E4), para o parágrafo do relatório entrar na conta
const VULNERABLE_RESULTS: TestResult[] = [
  { hypothesisId: 'POST /checkout__race_condition__stock', status: 'failed', message: 'stateCheck: stockNeverNegative', durationMs: 200 },
  { hypothesisId: 'POST /checkout__timeout__api.stripe.com', status: 'failed', message: 'respondsWithin: o cliente ficou mais de 6000 ms sem resposta', durationMs: 6000 },
  { hypothesisId: 'POST /checkout__http_5xx_intermittent__api.stripe.com', status: 'failed', message: 'statusIn: a rota não respondeu em 10010 ms', durationMs: 10000 },
  { hypothesisId: 'POST /checkout__malformed_response__api.stripe.com', status: 'failed', message: 'statusIn: a rota não respondeu em 10009 ms', durationMs: 10000 },
];

const examples: Record<string, { routes: number; sensitive: number; hypotheses: number; specs: number; surfaceChars: number }> = {};
for (const example of ['checkout-express', 'checkout-express-fixed']) {
  const dir = path.join(ROOT, 'examples', example);
  const graph = await CodeGraph.create(defaultWasmDir(), silentHost);
  await indexFiles(graph, await listSourceFiles(dir), silentHost);
  const config = graph.tsParser!.withTree(readFileSync(path.join(dir, CHAOS_CONFIG_FILE), 'utf8'), false, readChaosConfig)!;
  const topology = buildTopology(graph, buildSystemGraph(graph, [], dir), dir);
  const surface = attackSurface(topology);
  const provider = recorder(example);
  const state = await runChaosPipeline(surface, { provider, invariantNames: config.invariants });
  if (example === 'checkout-express') await explainChaosOutcomes(chaosOutcomes(VULNERABLE_RESULTS, state.hypotheses), surface, { provider });
  examples[example] = {
    routes: topology.routes.length,
    sensitive: surface.routes.length,
    hypotheses: state.hypotheses.length,
    specs: state.specs.length,
    surfaceChars: JSON.stringify(surface).length,
  };
}

const tok = (chars: number, k: keyof typeof CHARS_PER_TOKEN) => Math.round(chars / CHARS_PER_TOKEN[k]);
const rows = calls.map((c) => ({
  ...c,
  inputTokens: { low: tok(c.systemChars + c.userChars, 'low'), central: tok(c.systemChars + c.userChars, 'central'), high: tok(c.systemChars + c.userChars, 'high') },
  outputTokens: { low: tok(c.outputChars, 'low'), central: tok(c.outputChars, 'central'), high: tok(c.outputChars, 'high') },
  systemTokens: tok(c.systemChars, 'central'),
}));

console.log('| exemplo | nó | tier | max_tokens | system (tok) | entrada (tok) | saída (tok) |');
console.log('|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.example} | ${r.node} | ${r.tier} | ${r.maxTokens} | ${r.systemTokens} | ${r.inputTokens.central} (${r.inputTokens.low}–${r.inputTokens.high}) | ${r.outputTokens.central} (${r.outputTokens.low}–${r.outputTokens.high}) |`);
console.log('\n', JSON.stringify(examples, null, 2));

mkdirSync(path.join(ROOT, '.shieldepy'), { recursive: true });
writeFileSync(path.join(ROOT, '.shieldepy', 'estimate-chaos-cost.json'), JSON.stringify({ charsPerToken: CHARS_PER_TOKEN, examples, calls: rows }, null, 2));
