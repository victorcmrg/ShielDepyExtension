// Especialistas Network e Concurrency: um por hipótese testável. Tier `fast` — só escolhem
// parâmetros e invariantes de uma spec que já nasce válida (o padrão do motor). Sem provider, ou se
// a resposta não servir, fica o padrão.

import { canonicalJson, type AttackSurface } from '@shieldepy/core';
import { completeDetailed, isAbortError, type Completion, type LLMProvider, type Logger } from '../provider';
import { stripFences } from '../text';
import type { Hypothesis } from './hypotheses';
import { defaultSpec, LIMITS, MALFORMED_BODIES, parseSpec, type ChaosSpec } from './specs';

export interface SpecialistDeps {
  provider?: LLMProvider;
  /** Nomes das funções em `invariants` do `shieldepy.chaos.config.ts` (só os nomes; nunca o corpo). */
  invariantNames?: string[];
  log?: Logger;
  signal?: AbortSignal;
}

export interface SpecResult {
  spec?: ChaosSpec;
  completion?: Completion;
  /** Parâmetros/invariantes da IA descartados na validação. */
  dropped: string[];
  error?: string;
}

const INVARIANTS_DOC = [
  '- {"kind":"statusIn","statuses":[502,503]}: toda resposta com um destes status',
  `- {"kind":"respondsWithin","ms":N}: toda resposta chega antes de N ms (${LIMITS.respondsWithinMs.min}–${LIMITS.respondsWithinMs.max})`,
  '- {"kind":"noUnhandledError"}: nenhum 500 (exceção não tratada)',
  '- {"kind":"maxSuccesses","count":N}: no máximo N respostas 2xx (só concorrência)',
  '- {"kind":"stateCheck","name":"..."}: invariante de negócio declarado pelo projeto (só os nomes listados)',
].join('\n');

/** System estável por agente (vai para o cache de prompt). */
export function specialistSystem(agent: 'network' | 'concurrency'): string {
  const params =
    agent === 'network'
      ? [
          `- timeout: {"delayMs": ${LIMITS.delayMs.min}–${LIMITS.delayMs.max}} (atraso injetado na API) e um respondsWithin abaixo dele`,
          `- http_5xx_intermittent: {"status": ${LIMITS.statuses5xx.join(' | ')}}`,
          `- malformed_response: {"body": ${MALFORMED_BODIES.map((b) => `"${b}"`).join(' | ')}}`,
        ].join('\n')
      : `- race_condition: {"parallel": ${LIMITS.parallel.min}–${LIMITS.parallel.max}} requisições iguais ao mesmo tempo`;
  return [
    `Você é o especialista de ${agent === 'network' ? 'falhas de rede' : 'concorrência'} do ShielDepy.`,
    'Recebe UMA hipótese de falha já validada e a rota (operações de I/O em ordem, tags). Escolha os parâmetros do',
    'teste e os invariantes que devem continuar verdadeiros sob a falha. Você não escreve código e não vê dados:',
    'a requisição vem do projeto.',
    '',
    'Parâmetros possíveis:',
    params,
    '',
    'Invariantes possíveis:',
    INVARIANTS_DOC,
    '',
    'Responda APENAS com JSON, sem markdown: {"<parâmetro>": ..., "expect": [<invariantes>], "why": "<uma frase>"}',
  ].join('\n');
}

export async function specifyTest(h: Hypothesis, surface: AttackSurface, deps: SpecialistDeps = {}): Promise<SpecResult> {
  const names = deps.invariantNames ?? [];
  const base = defaultSpec(h, names);
  if (!base) return { dropped: [], error: `${h.failure} não tem template de teste no MVP` };
  if (!deps.provider) return { spec: base, dropped: [] };

  const route = surface.routes.find((r) => r.id === h.routeId);
  const input = { hypothesis: { failure: h.failure, target: h.target, rationale: h.rationale }, route, invariants: names, default: base };
  let completion: Completion | undefined;
  try {
    completion = await completeDetailed(deps.provider, {
      system: specialistSystem(base.kind),
      cacheSystem: true,
      messages: [{ role: 'user', content: canonicalJson(input, 2) }],
      tier: 'fast',
      maxTokens: 800,
      json: true,
      signal: deps.signal,
    });
    const { spec, dropped } = parseSpec(stripFences(completion.text), base, names);
    if (dropped.length > 0) deps.log?.(`[${base.kind}] ${h.id}: ${dropped.length} item(ns) da IA descartado(s)`);
    return { spec, completion, dropped };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const error = err instanceof Error ? err.message : String(err);
    return { spec: base, dropped: [], error, ...(completion && { completion }) };
  }
}
