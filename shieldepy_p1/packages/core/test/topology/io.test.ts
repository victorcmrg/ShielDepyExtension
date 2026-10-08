import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifySql, ioOperationOf, type CodeGraph, type IoOperation } from '../../src/index';
import { createGraph, Fixture, indexFile } from '../helpers';

describe('E2/2c — SQL classificado pelos tokens', () => {
  it('verbo, tabela principal e todas as tabelas', () => {
    expect(classifySql('SELECT quantity FROM stock WHERE product_id = $1')).toEqual({ kind: 'read', verb: 'SELECT', table: 'stock', tables: ['stock'] });
    expect(classifySql('INSERT INTO orders (a) SELECT a FROM cart')).toMatchObject({ kind: 'write', verb: 'INSERT', table: 'orders', tables: ['orders', 'cart'] });
    expect(classifySql('update ONLY public.Stock set q = q - 1')).toMatchObject({ kind: 'write', table: 'public.stock' });
    expect(classifySql('DELETE FROM "Orders" WHERE id = $1')).toMatchObject({ kind: 'write', table: 'Orders' });
    expect(classifySql('SELECT * FROM a JOIN b ON a.id = b.a_id')).toMatchObject({ table: 'a', tables: ['a', 'b'] });
  });

  it('trava de linha, transação, CTE e subconsulta', () => {
    expect(classifySql('SELECT q FROM stock WHERE id = $1 FOR UPDATE')).toMatchObject({ kind: 'read', lock: true });
    expect(classifySql('SELECT q FROM stock FOR NO KEY UPDATE')).toMatchObject({ lock: true });
    expect(classifySql('BEGIN')).toEqual({ kind: 'tx', verb: 'BEGIN', tables: [] });
    expect(classifySql('commit;')).toMatchObject({ kind: 'tx', verb: 'COMMIT' });
    // o verbo principal é o de fora; a CTE não é tabela
    expect(classifySql('WITH low AS (SELECT id FROM stock WHERE q < 5) UPDATE stock SET flag = true WHERE id IN (SELECT id FROM low)')).toMatchObject({
      kind: 'write',
      verb: 'UPDATE',
      table: 'stock',
      tables: ['stock'],
    });
  });

  it('comentário e string nunca viram verbo nem tabela', () => {
    expect(classifySql("-- DELETE FROM x\nSELECT 'UPDATE y' FROM z /* INSERT INTO w */")).toEqual({ kind: 'read', verb: 'SELECT', table: 'z', tables: ['z'] });
    expect(classifySql('VACUUM')).toEqual({ kind: 'unknown', tables: [] });
  });
});

describe('E2/2c — operações de I/O pelo pacote resolvido', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  /** As operações de I/O do arquivo, sem os campos de posição. */
  const ops = (file: string) =>
    graph
      .callSitesIn(file)
      .map((s) => ioOperationOf(s, file))
      .filter((o): o is IoOperation => !!o)
      .map(({ symbol: _s, file: _f, line: _l, ...rest }) => rest);

  it('pg: campo `Pool`, cliente de `pool.connect()` e `query` de outra coisa que não é pg', () => {
    const f = indexFile(
      graph,
      fx,
      'repo.ts',
      [
        "import { Pool } from 'pg';",
        'class Cache { query(sql: string) {} }',
        'export class Repo {',
        '  constructor(private db: Pool, private cache: Cache) {}',
        '  async move(sql: string) {',
        "    await this.db.query('SELECT q FROM stock WHERE id = $1 FOR UPDATE');",
        '    const client = await this.db.connect();',
        "    await client.query('BEGIN');",
        "    await client.query('UPDATE stock SET q = q - 1');",
        '    await client.query(sql);',
        "    this.cache.query('SELECT 1 FROM x');",
        '  }',
        '}',
      ].join('\n')
    );
    expect(ops(f)).toEqual([
      { kind: 'db_read', target: 'stock', via: 'pg', operation: 'SELECT', lock: true },
      { kind: 'db_tx', target: 'transaction', via: 'pg', operation: 'BEGIN' },
      { kind: 'db_write', target: 'stock', via: 'pg', operation: 'UPDATE' },
      { kind: 'db_unknown', target: 'dynamic', via: 'pg' },
    ]);
  });

  it('Prisma: model pelo receptor, leitura × escrita, $transaction e SQL cru', () => {
    const f = indexFile(
      graph,
      fx,
      'svc.ts',
      [
        "import { PrismaClient } from '@prisma/client';",
        'const prisma = new PrismaClient();',
        'export async function buy(id: string) {',
        '  await prisma.$transaction(async () => {});',
        '  const p = await prisma.product.findUnique({ where: { id } });',
        '  await prisma.order.create({ data: {} });',
        "  await prisma.$executeRawUnsafe('UPDATE stock SET q = q - 1');",
        '  await prisma.$connect();',
        '}',
      ].join('\n')
    );
    expect(ops(f)).toEqual([
      { kind: 'db_tx', target: 'transaction', via: 'prisma', operation: '$transaction' },
      { kind: 'db_read', target: 'product', via: 'prisma', operation: 'findUnique' },
      { kind: 'db_write', target: 'order', via: 'prisma', operation: 'create' },
      { kind: 'db_write', target: 'stock', via: 'prisma', operation: 'UPDATE' },
    ]);
  });

  it('fetch: global com e sem timeout, host do template, variável local e node-fetch', () => {
    const f = indexFile(
      graph,
      fx,
      'api.ts',
      [
        "import nodeFetch from 'node-fetch';",
        'export async function a(id: string, base: string, opts: RequestInit) {',
        "  await fetch('https://api.stripe.com/v1/charges', { method: 'POST' });",
        '  await fetch(`https://API.Correios.com.br/v1/${id}`, { signal: AbortSignal.timeout(3000) });',
        '  await fetch(`${base}/x`);',
        "  await fetch('https://x.com', opts);",
        "  await nodeFetch('https://legacy.io');",
        '}',
        "export async function b(fetch: (u: string) => void) { fetch('https://local.dev'); }",
      ].join('\n')
    );
    expect(ops(f)).toEqual([
      { kind: 'api_call', target: 'api.stripe.com', via: 'fetch', timeout: 'no' },
      { kind: 'api_call', target: 'api.correios.com.br', via: 'fetch', timeout: 'yes' },
      { kind: 'api_call', target: 'dynamic', via: 'fetch', timeout: 'no' },
      { kind: 'api_call', target: 'x.com', via: 'fetch', timeout: 'unknown' },
      { kind: 'api_call', target: 'legacy.io', via: 'fetch', timeout: 'no' },
    ]);
  });

  it('axios: posição da config por método, chamada direta e instância de axios.create', () => {
    const f = indexFile(
      graph,
      fx,
      'client.ts',
      [
        "import axios from 'axios';",
        "const api = axios.create({ baseURL: 'https://pay.io', timeout: 2000 });",
        'export async function run() {',
        "  await axios.get('https://a.io/x');",
        "  await axios.post('https://b.io/x', { v: 1 }, { timeout: 500 });",
        "  await axios({ url: 'https://c.io', method: 'post' });",
        "  await api.get('/charges');",
        '}',
      ].join('\n')
    );
    expect(ops(f)).toEqual([
      { kind: 'api_call', target: 'a.io', via: 'axios', operation: 'get', timeout: 'no' },
      { kind: 'api_call', target: 'b.io', via: 'axios', operation: 'post', timeout: 'yes' },
      { kind: 'api_call', target: 'dynamic', via: 'axios', operation: 'request', timeout: 'no' },
      { kind: 'api_call', target: 'dynamic', via: 'axios', operation: 'get', timeout: 'unknown' },
    ]);
  });
});
