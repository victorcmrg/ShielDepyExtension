import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGraph, collisionRuleIds, findCollisions, type Collision, type Rule } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry, scanDir, toRules, translateTriggers, type PgTriggerRow, type Registry } from '../src/index';

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));

let treeSitter: Registry;

beforeAll(async () => {
  treeSitter = await loadRegistry(defaultWasmDir());
});

/**
 * O mesmo sistema de pedidos escrito em 4 stacks, com as mesmas brigas plantadas:
 * pricing e tax escrevem `total` (write-write), audit lê `total` (2× read-after-write),
 * shipping escreve campo exclusivo e notification escuta outro evento (controles).
 */
const SCENARIOS: Array<{ label: string; dir: string; engine: () => Registry; resource: string; event: string }> = [
  { label: 'Node / TS', dir: 'pedidos-microservices', engine: () => treeSitter, resource: 'order', event: 'order.updated' },
  { label: 'Java / Spring', dir: 'pedidos-spring', engine: () => treeSitter, resource: 'Order', event: 'OrderUpdated' },
  { label: 'Python / Django', dir: 'pedidos-django', engine: () => treeSitter, resource: 'Order', event: 'pre_save' },
  { label: 'C# / MediatR', dir: 'pedidos-mediatr', engine: () => treeSitter, resource: 'Order', event: 'OrderUpdated' },
];

describe.each(SCENARIOS)('$label — sistema de pedidos', ({ dir, engine, resource, event }) => {
  let rules: Rule[];
  let collisions: Collision[];

  beforeAll(() => {
    rules = toRules(scanDir(path.join(EXAMPLES, dir, 'services'), engine()));
    collisions = findCollisions(buildGraph(rules));
  });

  it('write-write entre pricing e tax no campo total', () => {
    const hits = collisions.filter((c) => c.type === 'write-write');
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatchObject({ field: 'total', resource, event });
    expect(collisionRuleIds(hits[0]!).map((id) => id.split(':')[0]).sort()).toEqual(['pricing', 'tax']);
  });

  it('read-after-write do audit com ordering UNKNOWN (imprevisível)', () => {
    const hits = collisions.filter((c) => c.type === 'read-after-write');
    expect(hits.length).toBe(2);
    for (const c of hits) {
      expect(c).toMatchObject({ field: 'total', ordering: 'unknown' });
      if (c.type === 'read-after-write') expect(c.reader.startsWith('audit:')).toBe(true);
    }
  });

  it('não acusa shipping (campo exclusivo) nem notification (outro evento)', () => {
    const envolvidos = collisions.flatMap(collisionRuleIds);
    expect(envolvidos.some((id) => id.startsWith('shipping:'))).toBe(false);
    expect(envolvidos.some((id) => id.startsWith('notification:'))).toBe(false);
  });

  it('total de colisões = 3', () => {
    expect(collisions.length).toBe(3);
  });

  it('toda regra sabe de que arquivo e linha veio (pra virar Diagnostic)', () => {
    expect(rules.length).toBe(5);
    for (const r of rules) {
      expect(r.location?.file).toMatch(new RegExp(`${dir}/services/${r.source}/`));
      expect(r.location!.line).toBeGreaterThan(0);
    }
  });
});

describe('Postgres — triggers com ordem alfabética', () => {
  const fn = (body: string) => `CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END; $$;`;
  const row = (triggerName: string, body: string, tableName = 'orders', timing = 'BEFORE', events = ['UPDATE']): PgTriggerRow => ({
    triggerName,
    tableName,
    timing,
    events,
    functionName: `fn_${triggerName}`,
    functionSource: fn(body),
  });
  // nomes com prefixo numérico = padrão real p/ forçar a ordem de disparo do Postgres
  const rows = [
    row('trg_00_snapshot_total', 'NEW.audit_prev_total := NEW.total;'),
    row('trg_10_apply_discount', 'NEW.total := NEW.subtotal * (1 - discount(NEW.customer_tier));'),
    row('trg_20_apply_tax', 'NEW.total := NEW.subtotal * 1.1;'),
    row('trg_90_set_updated_at', 'NEW.updated_at := now();'),
    row('trg_welcome_email', 'INSERT INTO outbox(addr) VALUES (NEW.email); NEW.welcome_sent_at := now();', 'customers', 'AFTER', ['INSERT']),
  ];
  const rules = translateTriggers(rows);
  const collisions = findCollisions(buildGraph(rules));

  it('ordem alfabética do nome vira `order`', () => {
    expect(rules.find((r) => r.name === 'trg_00_snapshot_total')!.order).toBe(0);
    expect(rules.find((r) => r.name === 'trg_10_apply_discount')!.order).toBe(1);
  });

  it('write-write em orders.total (discount × tax)', () => {
    const hits = collisions.filter((c) => c.type === 'write-write');
    expect(hits.length).toBe(1);
    expect(hits[0]!.field).toBe('total');
  });

  it('snapshot lê total ANTES de discount/tax escreverem (reader-first)', () => {
    const hits = collisions.filter((c) => c.type === 'read-after-write');
    expect(hits.length).toBe(2);
    for (const c of hits) {
      expect(c).toMatchObject({ field: 'total', reader: 'orders.trg_00_snapshot_total:update', ordering: 'reader-first' });
    }
  });

  it('total de colisões = 3', () => {
    expect(collisions.length).toBe(3);
  });

  it('trigger de vários eventos vira uma regra por evento', () => {
    const multi = translateTriggers([row('trg_x', 'NEW.a := 1;', 't', 'BEFORE', ['INSERT', 'UPDATE'])]);
    expect(multi.map((r) => r.event)).toEqual(['before insert', 'before update']);
  });
});
