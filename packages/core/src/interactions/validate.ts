import type { Rule } from './model';

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Valida um `Rule[]` vindo de fora (fixture JSON, upload da web). Antes era um cast direto: uma
 * regra sem `reads` derrubava o detector com um 500. Lança com a posição e o campo inválido.
 */
export function parseRules(data: unknown): Rule[] {
  if (!Array.isArray(data)) throw new Error('esperado um array de regras');
  return data.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (typeof r !== 'object' || r === null) throw new Error(`regra ${i}: não é um objeto`);
    for (const field of ['id', 'resource', 'event'] as const) {
      if (typeof r[field] !== 'string' || !r[field]) throw new Error(`regra ${i}: campo "${field}" ausente ou inválido`);
    }
    for (const field of ['reads', 'writes'] as const) {
      if (!isStringArray(r[field])) throw new Error(`regra ${i}: "${field}" deve ser uma lista de strings`);
    }
    if (r.order !== undefined && r.order !== null && typeof r.order !== 'number') throw new Error(`regra ${i}: "order" deve ser número`);
    return {
      id: r.id as string,
      name: typeof r.name === 'string' ? r.name : (r.id as string),
      resource: r.resource as string,
      event: r.event as string,
      reads: r.reads as string[],
      writes: r.writes as string[],
      order: typeof r.order === 'number' ? r.order : undefined,
      condition: typeof r.condition === 'string' ? r.condition : undefined,
      source: typeof r.source === 'string' ? r.source : 'fixture',
    };
  });
}
