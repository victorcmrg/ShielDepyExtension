// Threat Modeler: o 1º nó com IA. Recebe só a superfície de ataque (fatos, sem código) e devolve
// hipóteses de falha do catálogo. Sem provider, ou se a resposta não servir, fica a lista-base do
// motor — o pipeline nunca depende da IA para funcionar.

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
  /** A chamada à IA (tokens e modelo), para o custo da execução. */
  completion?: Completion;
  /** Por que a resposta da IA foi descartada (o resultado ficou com a lista-base). */
  error?: string;
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

export async function modelThreats(surface: AttackSurface, deps: ThreatModelerDeps = {}): Promise<ThreatModel> {
  const baseline = baselineHypotheses(surface);
  if (!deps.provider) return { hypotheses: baseline, rejected: [], engine: 'offline' };
  if (surface.routes.length === 0) return { hypotheses: [], rejected: [], engine: 'offline' };

  let completion: Completion | undefined;
  try {
    completion = await completeDetailed(deps.provider, {
      system: threatModelerSystem(),
      cacheSystem: true,
      messages: [{ role: 'user', content: `Superfície de ataque (JSON):\n${canonicalJson(surface, 2)}` }],
      tier: 'deep',
      maxTokens: 4000,
      json: true,
      signal: deps.signal,
    });
    const ai = parseThreatModel(stripFences(completion.text), surface);
    if (ai.rejected.length > 0) deps.log?.(`[threat-modeler] ${ai.rejected.length} hipótese(s) da IA descartada(s)`);
    return {
      hypotheses: mergeHypotheses(baseline, ai.hypotheses),
      rejected: ai.rejected,
      engine: deps.provider.name,
      ...(ai.summary && { summary: ai.summary }),
      completion,
    };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[threat-modeler] IA indisponível ou resposta inválida — usando a lista-base do motor: ${error}`);
    return { hypotheses: baseline, rejected: [], engine: 'offline', error, ...(completion && { completion }) };
  }
}
