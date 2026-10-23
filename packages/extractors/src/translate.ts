import type { Rule } from '@shieldepy/core';
import type { ServiceRule } from './types';

/**
 * Traduz regras de serviços (Java/Python/C#/Node) para o idioma padrão (IR).
 * `order` fica UNDEFINED: nesses sistemas a ordem entre listeners/handlers do
 * mesmo evento não é garantida -> read-after-write vira "unknown" (imprevisível).
 */
export function toRules(items: ServiceRule[]): Rule[] {
  return items.map((h, i) => ({
    id: `${h.service}:${h.event}#${i}`,
    name: `${h.service} (${h.event})`,
    resource: h.resource,
    event: h.event,
    reads: h.reads,
    writes: h.writes,
    order: undefined,
    condition: undefined,
    source: h.service,
    location: h.file !== undefined ? { file: h.file, line: h.line ?? 0 } : undefined,
  }));
}
