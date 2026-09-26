// Pega o que o Postgres conta sobre cada trigger e devolve regras no idioma padrão (IR).

import type { Rule } from '@shieldepy/core';
import { extractFieldAccess } from './extract';

/** Uma linha de trigger como o Postgres entrega (já com o código da função). */
export interface PgTriggerRow {
  triggerName: string;
  tableName: string;
  /** "BEFORE" | "AFTER" | "INSTEAD OF" */
  timing: string;
  /** eventos que disparam o trigger, ex.: ["UPDATE"] ou ["INSERT","UPDATE"] */
  events: string[];
  functionName: string;
  /** código-fonte da função do trigger (ex.: pg_get_functiondef). */
  functionSource: string;
}

/** Traduz as linhas de trigger do Postgres para regras do idioma padrão. */
export function translateTriggers(rows: PgTriggerRow[]): Rule[] {
  const rules: Rule[] = [];

  for (const row of rows) {
    const { reads, writes } = extractFieldAccess(row.functionSource);

    // um trigger que reage a vários eventos (INSERT OR UPDATE) vira
    // uma regra por evento — pra poder brigar em cada balde certo.
    for (const ev of row.events) {
      rules.push({
        id: `${row.tableName}.${row.triggerName}:${ev.toLowerCase()}`,
        name: row.triggerName,
        resource: row.tableName,
        event: `${row.timing.toLowerCase()} ${ev.toLowerCase()}`,
        reads,
        writes,
        condition: undefined, // Postgres tem WHEN, mas fica opaco no MVP
        source: 'postgres',
      });
    }
  }

  assignPostgresOrder(rules);
  return rules;
}

/**
 * O Postgres dispara triggers do MESMO (tabela, evento) em ordem ALFABÉTICA do nome do
 * trigger. Refletimos isso em `order` (0 = roda primeiro), pra que a detecção de
 * read-after-write saiba quem lê antes/depois.
 */
function assignPostgresOrder(rules: Rule[]): void {
  const groups = new Map<string, Rule[]>();
  for (const r of rules) {
    const k = `${r.resource}::${r.event}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    group.forEach((r, i) => {
      r.order = i;
    });
  }
}
