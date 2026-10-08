// Custo de cada execução, a partir dos tokens que o provedor devolveu. Só modelos com preço
// conferido entram na conta: modelo sem preço sai em `unpriced` — nunca um número inventado.

import type { Completion, TokenUsage } from './provider';

/** US$ por 1M de tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Claude API (preço da Anthropic, 1ª parte), conferido em 2026-10-08 na referência oficial.
 * A escrita de cache custa 1,25× a entrada (TTL de 5 min). Bedrock/Vertex têm preço próprio.
 */
export const ANTHROPIC_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

const CACHE_WRITE_MULTIPLIER = 1.25;

/** Preço do modelo; aceita o id com data (`claude-haiku-4-5-20251001`). */
export function priceOf(model: string): ModelPrice | undefined {
  const exact = ANTHROPIC_PRICES[model];
  if (exact) return exact;
  const base = Object.keys(ANTHROPIC_PRICES).find((id) => model.startsWith(`${id}-`));
  return base ? ANTHROPIC_PRICES[base] : undefined;
}

/** Custo em US$ de uma chamada, ou `undefined` sem preço conhecido. */
export function costUsd(usage: TokenUsage, model: string): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  const million = 1_000_000;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      (usage.cacheWriteTokens ?? 0) * p.input * CACHE_WRITE_MULTIPLIER) /
    million
  );
}

export interface CostReport {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Soma das chamadas com preço conhecido. */
  usd: number;
  /** Modelos que responderam sem preço tabelado (o `usd` não inclui essas chamadas). */
  unpriced: string[];
  /** Chamadas cujo provider não devolveu os tokens. */
  withoutUsage: number;
}

/** Soma o que cada chamada de uma execução custou. */
export class CostMeter {
  private readonly totals: CostReport = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    usd: 0,
    unpriced: [],
    withoutUsage: 0,
  };

  add(completion: Completion): void {
    const t = this.totals;
    t.calls++;
    const u = completion.usage;
    if (!u) {
      t.withoutUsage++;
      return;
    }
    t.inputTokens += u.inputTokens;
    t.outputTokens += u.outputTokens;
    t.cacheReadTokens += u.cacheReadTokens ?? 0;
    t.cacheWriteTokens += u.cacheWriteTokens ?? 0;
    const usd = costUsd(u, completion.model);
    if (usd === undefined) {
      if (!t.unpriced.includes(completion.model)) t.unpriced.push(completion.model);
    } else {
      t.usd += usd;
    }
  }

  report(): CostReport {
    return { ...this.totals, unpriced: [...this.totals.unpriced] };
  }
}
