// Conexão com o Postgres e as migrations (decisão 0015). Com DATABASE_URL, um Postgres de verdade
// (node-postgres); sem, o PGlite — o Postgres compilado para WebAssembly, rodando dentro do Node —
// gravado em SHIELDEPY_DATA_DIR (padrão apps/api/data). Assim o dev e os testes não precisam
// instalar nada, e a produção só precisa da URL. Ao abrir, aplica as migrations pendentes.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** 'postgres' (DATABASE_URL) ou 'pglite' (arquivo local ou memória). */
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/** As migrations geradas pelo drizzle-kit (apps/api/drizzle). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url));
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

export interface OpenOptions {
  /** URL do Postgres; padrão: DATABASE_URL. */
  url?: string;
  /** Pasta do PGlite quando não há URL; 'memory://' fica só na memória. Padrão: SHIELDEPY_DATA_DIR/pglite. */
  pgliteDir?: string;
}

export async function openDatabase(opts: OpenOptions = {}): Promise<Database> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }
  const dir = opts.pgliteDir ?? join(process.env.SHIELDEPY_DATA_DIR ?? DEFAULT_DATA_DIR, 'pglite');
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}
