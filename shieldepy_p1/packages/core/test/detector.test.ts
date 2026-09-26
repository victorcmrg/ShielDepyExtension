import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGraph, collisionRuleIds, findCollisions, type Collision, type Rule } from '../src/index';
import { REPO_ROOT } from './helpers';

const rules = JSON.parse(readFileSync(path.join(REPO_ROOT, 'fixtures/postgres-example.json'), 'utf8')) as Rule[];
const collisions = findCollisions(buildGraph(rules));

const ww = (cs: Collision[]) => cs.filter((c) => c.type === 'write-write');
const raw = (cs: Collision[]) => cs.filter((c) => c.type === 'read-after-write');

describe('detector de colisões (fixture Postgres)', () => {
  it('detecta a colisão write-write plantada (orders.total)', () => {
    const hits = ww(collisions);
    expect(hits.length).toBe(1);
    const c = hits[0]!;
    expect(c.resource).toBe('orders');
    expect(c.event).toBe('before update');
    expect(c.field).toBe('total');
    expect([...collisionRuleIds(c)].sort()).toEqual(['trg_apply_discount', 'trg_apply_tax']);
  });

  it('detecta os read-after-write no campo orders.total (leitura desatualizada)', () => {
    const hits = raw(collisions);
    expect(hits.length).toBe(2);
    for (const c of hits) {
      if (c.type !== 'read-after-write') throw new Error('tipo');
      expect(c.field).toBe('total');
      expect(c.reader).toBe('trg_log_prev_total');
      // log roda em order=5, discount(10)/tax(20) rodam depois -> lê valor velho
      expect(c.ordering).toBe('reader-first');
    }
  });

  it('não inventa colisão onde não há (regras de controle)', () => {
    const envolvidos = new Set(collisions.flatMap(collisionRuleIds));
    // escreve um campo exclusivo (updated_at) -> não briga com ninguém
    expect(envolvidos.has('trg_set_updated_at')).toBe(false);
    // está em outro balde (customers/after insert), sozinho
    expect(envolvidos.has('trg_welcome_email')).toBe(false);
  });

  it('total de colisões detectadas = 3', () => {
    expect(collisions.length).toBe(3);
  });

  it('writer-first quando o leitor roda depois', () => {
    const cs = findCollisions(
      buildGraph([
        { id: 'w', name: 'w', resource: 'r', event: 'e', reads: [], writes: ['x'], order: 0, source: 't' },
        { id: 'r', name: 'r', resource: 'r', event: 'e', reads: ['x'], writes: [], order: 1, source: 't' },
      ])
    );
    expect(cs).toEqual([{ type: 'read-after-write', resource: 'r', event: 'e', field: 'x', reader: 'r', writer: 'w', ordering: 'writer-first' }]);
  });
});
