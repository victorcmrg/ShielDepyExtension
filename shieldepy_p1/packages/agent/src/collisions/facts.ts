import { collisionRuleIds, type Collision, type Rule } from '@shieldepy/core';

/** Visão enxuta de uma regra pra mandar à IA (sem caminhos absolutos do disco). */
export function ruleContext(r: Rule) {
  return {
    id: r.id,
    name: r.name,
    resource: r.resource,
    event: r.event,
    reads: r.reads,
    writes: r.writes,
    order: r.order ?? null,
    source: r.source,
  };
}

/** Só as regras que aparecem em alguma colisão — é o contexto que a IA precisa, nada além. */
export function involvedRules(collisions: Collision[], rules: Rule[]): Rule[] {
  const ids = new Set(collisions.flatMap(collisionRuleIds));
  return rules.filter((r) => ids.has(r.id));
}

/** Fatos numerados — a IA referencia cada diagnóstico por este `index`. */
export function indexedFacts(collisions: Collision[]) {
  return collisions.map((c, index) => ({ index, ...c }));
}
