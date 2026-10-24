// O banco da API (decisão 0015): as migrations do drizzle-kit aplicam num Postgres novo (PGlite),
// criam todas as tabelas do esquema e reabrir o mesmo banco não reaplica nada.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/shared/db/postgres';
import * as schema from '../src/shared/db/schema';

const TABLES = Object.values(schema as Record<string, unknown>)
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => getTableName(t))
  .sort();

describe('migrations (Drizzle + PGlite)', () => {
  it('criam todas as tabelas do esquema', async () => {
    const { db, close } = await openDatabase({ pgliteDir: 'memory://' });
    // node-postgres e PGlite devolvem { rows }
    const rows = (await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`)) as unknown as { rows: { table_name: string }[] };
    expect(rows.rows.map((r) => r.table_name)).toEqual(TABLES);
    await close();
  });

  it('reabrir o mesmo banco não reaplica (os dados ficam)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shieldepy-pg-'));
    try {
      const first = await openDatabase({ pgliteDir: dir });
      await first.db.insert(schema.companies).values({ name: 'Acme', createdAt: 1 });
      await first.close();
      const second = await openDatabase({ pgliteDir: dir });
      expect(await second.db.select({ name: schema.companies.name }).from(schema.companies)).toEqual([{ name: 'Acme' }]);
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
