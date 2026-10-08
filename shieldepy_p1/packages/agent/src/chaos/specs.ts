// Specs de teste: o que os especialistas (IA ou padrão do motor) preenchem. Nunca é código — é um
// formato pequeno e validado, que os templates (3e) transformam em `.spec.ts`. A requisição em si
// vem do `shieldepy.chaos.config.ts` do projeto; a IA não vê nem escolhe dados.

import type { Hypothesis } from './hypotheses';

/** O que tem que continuar verdadeiro sob a falha. */
export type Invariant =
  /** Toda resposta com um destes status. */
  | { kind: 'statusIn'; statuses: number[] }
  /** Toda resposta chega antes de `ms` (senão o cliente ficou pendurado). */
  | { kind: 'respondsWithin'; ms: number }
  /** Nenhum 500: exceção não tratada vazando para o cliente. */
  | { kind: 'noUnhandledError' }
  /** No máximo `count` respostas 2xx entre as requisições simultâneas. */
  | { kind: 'maxSuccesses'; count: number }
  /** Uma função declarada pelo projeto em `invariants` (ex.: `stockNeverNegative`) devolve true no fim. */
  | { kind: 'stateCheck'; name: string };

export interface NetworkSpec {
  kind: 'network';
  hypothesisId: string;
  routeId: string;
  host: string;
  fault:
    | { mode: 'delay'; delayMs: number }
    | { mode: 'status'; status: number }
    | { mode: 'malformed'; body: MalformedBody };
  expect: Invariant[];
  /** Quem preencheu os parâmetros. */
  source: 'ia' | 'motor';
}

export interface ConcurrencySpec {
  kind: 'concurrency';
  hypothesisId: string;
  routeId: string;
  /** Requisições simultâneas iguais. */
  parallel: number;
  expect: Invariant[];
  source: 'ia' | 'motor';
}

export type ChaosSpec = NetworkSpec | ConcurrencySpec;

export const MALFORMED_BODIES = ['html', 'truncated_json', 'empty', 'wrong_shape'] as const;
export type MalformedBody = (typeof MALFORMED_BODIES)[number];

/** Limites: um teste de caos tem que terminar rápido e não derrubar a máquina de CI. */
export const LIMITS = {
  delayMs: { min: 2_000, max: 30_000, default: 15_000 },
  /** Paciência do cliente no teste de timeout. Fica bem abaixo do atraso injetado. */
  respondsWithinMs: { min: 500, max: 20_000, default: 6_000 },
  parallel: { min: 2, max: 50, default: 10 },
  statuses5xx: [500, 502, 503, 504],
} as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

/** Os invariantes do projeto, verificados no fim de todo teste (o estado não pode ter quebrado). */
const stateChecks = (names: string[]): Invariant[] => names.map((name) => ({ kind: 'stateCheck', name }));

/** A spec padrão do motor para uma hipótese (sem IA, ou quando a IA não serve). */
export function defaultSpec(h: Hypothesis, invariantNames: string[]): ChaosSpec | undefined {
  const base = { hypothesisId: h.id, routeId: h.routeId, source: 'motor' as const };
  switch (h.failure) {
    case 'timeout':
      return {
        ...base,
        kind: 'network',
        host: h.target,
        fault: { mode: 'delay', delayMs: LIMITS.delayMs.default },
        expect: [{ kind: 'respondsWithin', ms: LIMITS.respondsWithinMs.default }, ...stateChecks(invariantNames)],
      };
    case 'http_5xx_intermittent':
      return {
        ...base,
        kind: 'network',
        host: h.target,
        fault: { mode: 'status', status: 503 },
        expect: [{ kind: 'noUnhandledError' }, { kind: 'statusIn', statuses: [502, 503, 504] }, ...stateChecks(invariantNames)],
      };
    case 'malformed_response':
      return {
        ...base,
        kind: 'network',
        host: h.target,
        fault: { mode: 'malformed', body: 'html' },
        expect: [{ kind: 'noUnhandledError' }, { kind: 'statusIn', statuses: [502] }, ...stateChecks(invariantNames)],
      };
    case 'race_condition':
      return { ...base, kind: 'concurrency', parallel: LIMITS.parallel.default, expect: [{ kind: 'noUnhandledError' }, ...stateChecks(invariantNames)] };
    default:
      return undefined; // sem template no MVP (retry_storm, partial_failure)
  }
}

/** Valida um invariante vindo da IA; `undefined` = descartado. */
function parseInvariant(raw: unknown, spec: ChaosSpec, invariantNames: string[]): Invariant | undefined {
  const i = (raw ?? {}) as Record<string, unknown>;
  switch (i.kind) {
    case 'statusIn': {
      const statuses = Array.isArray(i.statuses) ? i.statuses.filter((s): s is number => Number.isInteger(s) && s >= 100 && s <= 599) : [];
      return statuses.length > 0 ? { kind: 'statusIn', statuses: [...new Set(statuses)].sort((a, b) => a - b) } : undefined;
    }
    case 'respondsWithin':
      return typeof i.ms === 'number' ? { kind: 'respondsWithin', ms: clamp(i.ms, LIMITS.respondsWithinMs.min, LIMITS.respondsWithinMs.max) } : undefined;
    case 'noUnhandledError':
      return { kind: 'noUnhandledError' };
    case 'maxSuccesses':
      return spec.kind === 'concurrency' && Number.isInteger(i.count) && (i.count as number) >= 0 && (i.count as number) < spec.parallel
        ? { kind: 'maxSuccesses', count: i.count as number }
        : undefined;
    case 'stateCheck':
      return typeof i.name === 'string' && invariantNames.includes(i.name) ? { kind: 'stateCheck', name: i.name } : undefined;
    default:
      return undefined;
  }
}

/**
 * Aplica o que a IA propôs sobre a spec padrão: só os parâmetros que a falha permite, dentro dos
 * limites, e só invariantes válidos. Lança se não for JSON (quem chama fica com o padrão).
 */
export function parseSpec(text: string, base: ChaosSpec, invariantNames: string[]): { spec: ChaosSpec; dropped: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('resposta da IA não é JSON válido');
  }
  const o = (parsed ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object') throw new Error('JSON da IA não é um objeto');
  const dropped: string[] = [];
  let spec: ChaosSpec = { ...base, source: 'ia' };

  if (spec.kind === 'network') {
    const fault = spec.fault;
    if (fault.mode === 'delay' && typeof o.delayMs === 'number') spec = { ...spec, fault: { mode: 'delay', delayMs: clamp(o.delayMs, LIMITS.delayMs.min, LIMITS.delayMs.max) } };
    if (fault.mode === 'status' && o.status !== undefined) {
      if ((LIMITS.statuses5xx as readonly number[]).includes(o.status as number)) spec = { ...spec, fault: { mode: 'status', status: o.status as number } };
      else dropped.push(`status ${String(o.status)} fora de ${LIMITS.statuses5xx.join('/')}`);
    }
    if (fault.mode === 'malformed' && o.body !== undefined) {
      if ((MALFORMED_BODIES as readonly string[]).includes(o.body as string)) spec = { ...spec, fault: { mode: 'malformed', body: o.body as MalformedBody } };
      else dropped.push(`corpo ${String(o.body)} fora de ${MALFORMED_BODIES.join('/')}`);
    }
  } else if (typeof o.parallel === 'number') {
    spec = { ...spec, parallel: clamp(o.parallel, LIMITS.parallel.min, LIMITS.parallel.max) };
  }

  if (Array.isArray(o.expect)) {
    const expect: Invariant[] = [];
    o.expect.forEach((raw, index) => {
      const inv = parseInvariant(raw, spec, invariantNames);
      if (inv) expect.push(inv);
      else dropped.push(`invariante ${index} inválido: ${JSON.stringify(raw)?.slice(0, 120)}`);
    });
    // o teste de timeout precisa medir o tempo; sem invariante nenhum, fica o padrão
    const needsTime = spec.kind === 'network' && spec.fault.mode === 'delay';
    if (needsTime && !expect.some((e) => e.kind === 'respondsWithin')) expect.unshift(base.expect.find((e) => e.kind === 'respondsWithin')!);
    // os invariantes do projeto sempre entram: a IA pode acrescentar, não esquecer
    for (const check of stateChecks(invariantNames)) if (!expect.some((e) => e.kind === 'stateCheck' && e.name === (check as { name: string }).name)) expect.push(check);
    spec = { ...spec, expect: expect.length > 0 ? dedupe(expect) : base.expect };
  }
  // o atraso injetado tem que passar da paciência do cliente, senão o teste de timeout não mede nada
  if (spec.kind === 'network' && spec.fault.mode === 'delay') {
    const patience = spec.expect.find((e): e is Extract<Invariant, { kind: 'respondsWithin' }> => e.kind === 'respondsWithin')!;
    if (spec.fault.delayMs <= patience.ms + 1_000) spec = { ...spec, fault: { mode: 'delay', delayMs: Math.min(LIMITS.delayMs.max, patience.ms + 5_000) } };
  }
  return { spec, dropped };
}

function dedupe(list: Invariant[]): Invariant[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const key = JSON.stringify(i);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
