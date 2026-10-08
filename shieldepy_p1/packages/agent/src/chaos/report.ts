// Relatório da execução de caos (E4) em markdown: vai para o `$GITHUB_STEP_SUMMARY` e para o
// comentário do PR. O corpo é determinístico (rota, falha injetada, invariante violada, as
// operações da rota com arquivo:linha, custo e topologyHash). O único texto da IA é um parágrafo
// opcional que explica os achados; sem IA, ou se a resposta não servir, sai um parágrafo do motor.

import { canonicalJson, type AttackSurface, type SurfaceRoute } from '@shieldepy/core';
import type { Severity } from '../collisions/types';
import type { CostReport } from '../cost';
import { completeDetailed, isAbortError, type Completion, type Engine, type LLMProvider, type Logger } from '../provider';
import { stripFences } from '../text';
import { catalogEntry } from './catalog';
import type { Hypothesis } from './hypotheses';
import type { ChaosOutcome } from './results';
import { CHAOS_TESTS_DIR, specFileName } from './templates';

/** Marca do comentário no PR: o workflow edita o último comentário em vez de empilhar. */
export const CHAOS_REPORT_MARKER = '<!-- shieldepy-chaos -->';

export interface ChaosReportInput {
  /** Nome do projeto (a pasta). */
  label: string;
  surface: AttackSurface;
  hypotheses: Hypothesis[];
  /** Ausente: os testes não rodaram (`--no-run` ou erro de ambiente). */
  outcomes?: ChaosOutcome[];
  failOn: Severity;
  hits: number;
  /** Quem escreveu as hipóteses. */
  engine: Engine;
  cost: CostReport;
  runError?: string;
  explanation?: ChaosExplanation;
}

export interface ChaosExplanation {
  text: string;
  engine: Engine;
  completion?: Completion;
  error?: string;
}

const SEVERITY_ICON: Record<Severity, string> = { Crítico: '🔴', Alto: '🟠', Médio: '🟡', Baixo: '⚪' };

/** Texto de tabela markdown: sem quebra de linha e sem `|`. */
const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
const code = (s: string) => `\`${s.replace(/`/g, "'")}\``;
const secs = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

function operationsList(route: SurfaceRoute | undefined, target: string): string[] {
  if (!route) return [];
  return route.operations.map((o) => {
    const extra = [o.timeout === 'no' ? 'sem timeout' : undefined, o.lock ? 'FOR UPDATE' : undefined, o.confidence === 'heuristic' ? 'por nome' : undefined].filter(Boolean);
    const line = `${o.order}. ${code(`${o.kind} ${o.target}`)} em ${code(o.in)} (${code(o.at)})${extra.length ? `, ${extra.join(', ')}` : ''}`;
    return o.target === target ? `- **${line}** ← alvo da falha` : `- ${line}`;
  });
}

export function renderChaosReport(input: ChaosReportInput): string {
  const { outcomes, surface } = input;
  const routes = new Map(surface.routes.map((r) => [r.id, r]));
  const failed = outcomes?.filter((o) => o.status === 'failed') ?? [];
  const passed = outcomes?.filter((o) => o.status === 'passed') ?? [];
  const invalid = outcomes?.filter((o) => o.status === 'invalid') ?? [];
  const tested = new Set(outcomes?.map((o) => o.hypothesisId));
  const untested = input.hypotheses.filter((h) => !tested.has(h.id));
  const out: string[] = [CHAOS_REPORT_MARKER, `## 🔥 ShielDepy — engenharia de caos em ${code(input.label)}`, ''];

  if (input.runError) out.push(`> ⚠️ **Os testes não rodaram (erro de ambiente).** ${cell(input.runError.split('\n', 1)[0]!)}`);
  else if (!outcomes) out.push('> Testes gerados, mas não executados (`--no-run`).');
  else if (input.hits > 0) out.push(`> ❌ **Bloqueado:** ${input.hits} achado(s)${input.failOn === 'Baixo' ? '' : ` com severidade ${input.failOn} ou pior`}.`);
  else if (outcomes.length > 0 && invalid.length === outcomes.length) out.push('> ⚠️ **Nada foi provado:** todos os testes saíram inválidos (o controle, sem caos, falhou).');
  else if (failed.length > 0) out.push(`> ✅ **Passou no portão** (${input.failOn} ou pior), com ${failed.length} achado(s) abaixo dele.`);
  else out.push('> ✅ **Passou:** o código aguentou todas as falhas injetadas.');
  out.push('');
  if (outcomes) out.push(`**${failed.length}** achado(s) · **${passed.length}** aguentou(aram) · **${invalid.length}** inválido(s) · **${untested.length}** hipótese(s) sem teste`, '');

  if (input.explanation?.text) out.push(input.explanation.text, '');

  if (failed.length > 0) {
    out.push('### Achados', '', '| Severidade | Rota | Falha injetada | Alvo | Invariante violada | Tempo |', '|---|---|---|---|---|---|');
    for (const o of failed) out.push(`| ${SEVERITY_ICON[o.severity!]} ${o.severity} | ${code(o.routeId)} | ${code(o.failure)} | ${code(o.target)} | ${cell(o.message ?? '')} | ${secs(o.durationMs)} |`);
    out.push('');
    for (const o of failed) {
      const h = input.hypotheses.find((x) => x.id === o.hypothesisId);
      out.push(`<details><summary><b>${cell(o.routeId)}</b> · ${o.failure} em ${cell(o.target)}</summary>`, '');
      if (h?.rationale) out.push(`**Por quê:** ${cell(h.rationale)}`, '');
      const ops = operationsList(routes.get(o.routeId), o.target);
      if (ops.length > 0) out.push('**Operações da rota, em ordem:**', '', ...ops, '');
      out.push(`Teste: ${code(`${CHAOS_TESTS_DIR}/${specFileName(o.hypothesisId)}`)} (o controle, sem caos, passou)`, '', '</details>', '');
    }
  }

  if (passed.length > 0) {
    out.push('### Aguentou', '');
    for (const o of passed) out.push(`- ✅ ${code(o.routeId)} · ${o.failure} em ${code(o.target)} (${secs(o.durationMs)})`);
    out.push('');
  }
  if (invalid.length > 0) {
    out.push('### Inválidos (não contam no portão)', '');
    for (const o of invalid) out.push(`- ⚠️ ${code(o.routeId)} · ${o.failure} em ${code(o.target)}: ${cell(o.message ?? '')}`);
    out.push('');
  }
  if (untested.length > 0) {
    out.push('### Hipóteses sem teste no MVP (não bloqueiam)', '');
    for (const h of untested) {
      const why = catalogEntry(h.failure)?.agent === 'db_chaos' ? 'precisa de falha injetada no banco (DB_Chaos, depois)' : 'sem template de teste no MVP';
      out.push(`- ${code(h.routeId)} · ${h.failure} em ${code(h.target)}: ${why}`);
    }
    out.push('');
  }

  const c = input.cost;
  const cost =
    c.calls === 0
      ? 'IA: nenhuma chamada (custo zero)'
      : `IA: ${c.calls} chamada(s), ${c.inputTokens} tokens de entrada, ${c.outputTokens} de saída, ${c.cacheReadTokens} do cache → US$ ${c.usd.toFixed(4).replace('.', ',')}${c.unpriced.length ? ` (sem preço: ${c.unpriced.join(', ')})` : ''}`;
  const engine = input.engine === 'offline' ? 'motor (offline)' : `IA (${input.engine})`;
  out.push('---', `<sub>Hipóteses: ${engine} · ${cost} · topologia ${code(surface.topologyHash.slice(0, 16))}</sub>`, '');
  return out.join('\n');
}

/** Parágrafo do motor: o que quebrou, onde e o que fazer, sem IA. */
export function offlineChaosParagraph(outcomes: ChaosOutcome[]): string {
  const failed = outcomes.filter((o) => o.status === 'failed');
  if (failed.length === 0) return '';
  const parts = failed.map((o) => {
    const what =
      o.failure === 'race_condition'
        ? `requisições simultâneas em ${o.routeId} corrompem ${o.target}`
        : o.message?.includes('não respondeu') || o.message?.startsWith('respondsWithin')
          ? `com ${o.target} sob ${o.failure}, ${o.routeId} fica sem responder`
          : `com ${o.target} sob ${o.failure}, ${o.routeId} quebra a invariante`;
    return `${what} (${o.message})`;
  });
  return `**Resumo:** ${parts.join('; ')}.`;
}

export function chaosExplainerSystem(): string {
  return [
    'Você é o ShielDepy, uma ferramenta de engenharia de caos dirigida por análise estática.',
    'Você recebe ACHADOS já provados: testes de caos em que o controle (sem falha) passou e o teste com a falha injetada',
    'quebrou uma invariante. Cada achado traz a rota, a falha, a mensagem da invariante e as operações de I/O da rota em ordem.',
    'Você NÃO vê o código e não deve inventar nomes de arquivo, função ou linha que não estejam nos fatos.',
    '',
    'Escreva UM parágrafo em português do Brasil (no máximo 120 palavras) para o autor do PR: a causa provável de cada',
    'achado, ligando-a às operações (ex.: "lê stock, espera o Stripe e só depois grava"), e a correção típica',
    '(reservar com UPDATE condicional, transação com FOR UPDATE, timeout com AbortSignal, tratar a resposta da API e',
    'responder 502). Sem markdown de título, sem listas, sem blocos de código.',
    '',
    'Responda SOMENTE com JSON: {"paragraph": "..."}',
  ].join('\n');
}

const MAX_PARAGRAPH = 1500;

export function parseChaosParagraph(text: string): string {
  const data = JSON.parse(stripFences(text)) as { paragraph?: unknown };
  const p = typeof data.paragraph === 'string' ? data.paragraph.trim() : '';
  if (!p) throw new Error('resposta sem "paragraph"');
  if (p.includes('```')) throw new Error('o parágrafo trouxe bloco de código');
  return p.length > MAX_PARAGRAPH ? `${p.slice(0, MAX_PARAGRAPH - 1)}…` : p;
}

/** O parágrafo do relatório: da IA quando há provider e achados; senão (ou se falhar), do motor. */
export async function explainChaosOutcomes(
  outcomes: ChaosOutcome[],
  surface: AttackSurface,
  deps: { provider?: LLMProvider; log?: Logger; signal?: AbortSignal } = {}
): Promise<ChaosExplanation> {
  const offline = offlineChaosParagraph(outcomes);
  const failed = outcomes.filter((o) => o.status === 'failed');
  if (!deps.provider || failed.length === 0) return { text: offline, engine: 'offline' };

  const routes = new Map(surface.routes.map((r) => [r.id, r]));
  const facts = failed.map((o) => ({
    route: o.routeId,
    failure: o.failure,
    target: o.target,
    severity: o.severity,
    violated: o.message,
    operations: routes.get(o.routeId)?.operations.map((op) => ({ order: op.order, kind: op.kind, target: op.target, in: op.in, at: op.at, ...(op.timeout && { timeout: op.timeout }) })),
  }));
  let completion: Completion | undefined;
  try {
    completion = await completeDetailed(deps.provider, {
      system: chaosExplainerSystem(),
      messages: [{ role: 'user', content: `Achados (JSON):\n${canonicalJson(facts, 2)}` }],
      tier: 'fast',
      maxTokens: 800,
      json: true,
      signal: deps.signal,
    });
    return { text: `**Leitura da IA:** ${parseChaosParagraph(completion.text)}`, engine: deps.provider.name, completion };
  } catch (err) {
    if (isAbortError(err)) throw err;
    const error = err instanceof Error ? err.message : String(err);
    deps.log?.(`[relatório] IA indisponível ou resposta inválida — parágrafo do motor: ${error}`);
    return { text: offline, engine: 'offline', error, ...(completion && { completion }) };
  }
}
