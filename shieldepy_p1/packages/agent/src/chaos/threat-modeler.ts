// Threat Modeler: o 1º nó com IA. Recebe só a superfície de ataque (fatos, sem código) e devolve
// hipóteses de falha do catálogo. Sem provider, ou se a resposta não servir, fica a lista-base do
// motor — o pipeline nunca depende da IA para funcionar.
//
// A superfície vai em LOTES de rotas (5g): a resposta cresce ~500 tokens por rota que grava dados,
// e uma chamada única com a superfície inteira estourava o max_tokens a partir de ~7 rotas (a IA
// perdia a contribuição e a chamada era cobrada assim mesmo). Cada lote é validado contra as rotas
// dele; um lote que falha não derruba os outros, e a lista-base do motor vale sempre.

import { canonicalJson, type AttackSurface } from '@shieldepy/core';
import { completeDetailed, isAbortError, type Completion, type Engine, type LLMProvider, type Logger } from '../provider';
import { stripFences } from '../text';
import { CATALOG } from './catalog';
import { baselineHypotheses, mergeHypotheses, parseThreatModel, type Hypothesis, type RejectedHypothesis } from './hypotheses';

export interface ThreatModel {
  hypotheses: Hypothesis[];
  rejected: RejectedHypothesis[];
  engine: Engine;
  summary?: string;
  /** Cada chamada à IA (uma por lote), com tokens e modelo, para o custo da execução. */
  completions: Completion[];
  /** Lotes cuja resposta foi descartada, e por quê (as rotas deles ficaram com a lista-base). */
  errors: string[];
}

/** Rotas por chamada: ~500 tokens de resposta por rota de escrita, com folga para o raciocínio. */
export const ROUTES_PER_BATCH = 5;
/** Chamadas simultâneas, no máximo (limite de requisições da API). */
const MAX_PARALLEL = 4;
/** max_tokens de um lote: o raciocínio do Sonnet/Opus 5.5 também gasta isso. */
export const batchMaxTokens = (routes: number) => 2000 + 1000 * routes;

/** A superfície em lotes de rotas; cada lote leva só as colisões que tocam as rotas dele. */
export function surfaceBatches(surface: AttackSurface, size = ROUTES_PER_BATCH): AttackSurface[] {
  const out: AttackSurface[] = [];
  for (let i = 0; i < surface.routes.length; i += size) {
    const routes = surface.routes.slice(i, i + size);
    const ids = new Set(routes.map((r) => r.id));
    out.push({ ...surface, routes, collisions: surface.collisions.filter((c) => c.routes.some((id) => ids.has(id))) });
  }
  return out;
}

/** `fn` sobre cada item, com no máximo `limit` ao mesmo tempo; o resultado segue a ordem dos itens. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ThreatModelerDeps {
  provider?: LLMProvider;
  log?: Logger;
  signal?: AbortSignal;
}

/** System prompt estável (vai para o cache de prompt): persona, regras e o catálogo como tabela. */
export function threatModelerSystem(): string {
  const catalog = CATALOG.map((e) => `- ${e.id} (agente: ${e.agent}${e.testable ? '' : ', sem teste automático no MVP'}): ${e.description}`).join('\n');
  return [
    'Você é o Threat Modeler do ShielDepy, uma ferramenta de engenharia de caos dirigida por análise estática.',
    'Você recebe a SUPERFÍCIE DE ATAQUE de um sistema: rotas HTTP, as operações de I/O de cada uma em ordem de execução,',
    'as tags de sensibilidade (provadas pelo motor determinístico) e colisões entre regras. Você NÃO vê o código.',
    '',
    'Sua tarefa: para cada rota, dizer quais falhas de produção do catálogo abaixo valem ser testadas, com que prioridade',
    'e por quê, em uma ou duas frases concretas que citem as operações da rota (ex.: "lê stock, chama api.stripe.com e só',
    'depois grava stock: duas compras simultâneas veem o mesmo estoque").',
    '',
    'Catálogo (use SOMENTE estes ids):',
    catalog,
    '',
    'Regras:',
    '- routeId tem que ser exatamente o id de uma rota da superfície.',
    '- target é o host da API (falhas de rede) ou a tabela (corrida/banco), exatamente como aparece nas operações ou tags.',
    '- priority: 1 = alta, 2 = média, 3 = baixa.',
    '- Não invente rotas, hosts, tabelas ou falhas. Itens fora disso são descartados automaticamente.',
    '- Responda APENAS com JSON, sem markdown, no formato:',
    '{"summary": "<visão geral em até 3 frases>", "hypotheses": [{"routeId": "...", "failure": "...", "target": "...", "priority": 1, "rationale": "..."}]}',
    'Escreva em português do Brasil.',
  ].join('\n');
}

interface BatchResult {
  hypotheses: Hypothesis[];
  rejected: RejectedHypothesis[];
  summary?: string;
  completion?: Completion;
  error?: string;
}

/** Uma chamada do Threat Modeler para um lote de rotas. */
async function modelBatch(batch: AttackSurface, provider: LLMProvider, deps: ThreatModelerDeps): Promise<BatchResult> {
  let completion: Completion | undefined;
  try {
    completion = await completeDetailed(provider, {
      system: threatModelerSystem(),
      cacheSystem: true,
      messages: [{ role: 'user', content: `Superfície de ataque (JSON):\n${canonicalJson(batch, 2)}` }],
      tier: 'deep',
      maxTokens: batchMaxTokens(batch.routes.length),
      json: true,
      signal: deps.signal,
    });
    const ai = parseThreatModel(stripFences(completion.text), batch);
    return { hypotheses: ai.hypotheses, rejected: ai.rejected, ...(ai.summary && { summary: ai.summary }), completion };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return { hypotheses: [], rejected: [], error: err instanceof Error ? err.message : String(err), ...(completion && { completion }) };
  }
}

export async function modelThreats(surface: AttackSurface, deps: ThreatModelerDeps = {}): Promise<ThreatModel> {
  const baseline = baselineHypotheses(surface);
  const offline = (hypotheses: Hypothesis[]): ThreatModel => ({ hypotheses, rejected: [], engine: 'offline', completions: [], errors: [] });
  if (!deps.provider) return offline(baseline);
  if (surface.routes.length === 0) return offline([]);
  const provider = deps.provider;

  const batches = surfaceBatches(surface);
  const label = (i: number) => (batches.length > 1 ? `lote ${i + 1}/${batches.length}: ` : '');
  const parts = await pool(batches, MAX_PARALLEL, (b) => modelBatch(b, provider, deps));

  const errors = parts.flatMap((p, i) => (p.error ? [`${label(i)}${p.error}`] : []));
  for (const e of errors) deps.log?.(`[threat-modeler] IA indisponível ou resposta inválida — esse lote fica com a lista-base do motor: ${e}`);
  const rejected = parts.flatMap((p, i) => p.rejected.map((r) => ({ ...r, reason: `${label(i)}${r.reason}` })));
  if (rejected.length > 0) deps.log?.(`[threat-modeler] ${rejected.length} hipótese(s) da IA descartada(s)`);
  const answered = parts.filter((p) => !p.error);
  const summary = answered.map((p) => p.summary).filter(Boolean).join(' ');
  return {
    // os lotes não se sobrepõem (cada rota está em um só), então juntar é concatenar
    hypotheses: mergeHypotheses(baseline, parts.flatMap((p) => p.hypotheses)),
    rejected,
    engine: answered.length > 0 ? provider.name : 'offline',
    ...(summary && { summary }),
    completions: parts.flatMap((p) => (p.completion ? [p.completion] : [])),
    errors,
  };
}
