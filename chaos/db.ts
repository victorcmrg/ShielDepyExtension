// Gerado pelo `shieldepy chaos --init`: o banco dos testes de caos. Pode editar (o --init não sobrescreve).
// PGlite: o Postgres de verdade em WebAssembly, no mesmo processo. O app continua importando o `pg`;
// o chaos/setup.ts troca o Pool e o Client dele pelos daqui.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const db = new PGlite();

/** O esquema, relativo à raiz do projeto, na ordem de aplicação. */
const SCHEMA = ['apps/api/drizzle/0000_inicial.sql', 'examples/checkout-fastify-fixed/chaos/schema.sql', 'examples/checkout-fastify/chaos/schema.sql', 'fixtures/postgres-schema.sql', 'scripts/dataset/contratos/pg-crud/chaos/schema.sql', 'scripts/dataset/contratos/prisma-express/chaos/schema.sql'];

const ready = (async () => {
  for (const file of SCHEMA) await db.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
})();

// Um Postgres de verdade sempre devolve a vez ao event loop (a rede); o PGlite não. Sem esta pausa,
// leitura e escrita de uma requisição rodam juntas e o teste de corrida passa num código que corre.
const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

type Query = string | { text: string; values?: unknown[] };
type Result = { rows: any[]; rowCount: number; fields: unknown[] };
type Callback = (err: Error | null, result?: Result) => void;

/** `query(text, values?)`, `query({ text, values })` e os dois com callback no fim, como no `pg`. */
function run(q: Query, a?: unknown, b?: unknown): Promise<Result> | undefined {
  const callback = (typeof a === 'function' ? a : b) as Callback | undefined;
  const values = (typeof q === 'string' ? (Array.isArray(a) ? a : undefined) : (q.values ?? (Array.isArray(a) ? a : undefined))) as any[] | undefined;
  const result = (async () => {
    await ready;
    await pause();
    const r = await db.query(typeof q === 'string' ? q : q.text, values);
    return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };
  })();
  if (!callback) return result;
  result.then((r) => callback(null, r), (err) => callback(err));
  return undefined;
}

// Uma conexão só: um BEGIN/COMMIT de um cliente vale para todos (o PGlite tem uma sessão).
export class Client {
  constructor(_config?: unknown) {}
  async connect(): Promise<void> {}
  query(q: Query, a?: unknown, b?: unknown) {
    return run(q, a, b);
  }
  release(): void {}
  async end(): Promise<void> {}
  on(): this {
    return this;
  }
}

export class Pool {
  constructor(_config?: unknown) {}
  query(q: Query, a?: unknown, b?: unknown) {
    return run(q, a, b);
  }
  async connect(): Promise<Client> {
    return new Client();
  }
  async end(): Promise<void> {}
  on(): this {
    return this;
  }
}

/** Os valores do registro de exemplo. O contrato usa os mesmos nas rotas com parâmetro. */
const SEED_TEXT = 'registro-1';
const SEED_UUID = '00000000-0000-4000-8000-000000000001';

type SeedColumn = { tbl: string; name: string; type: string; udt: string; nullable: boolean; defaulted: boolean; auto: boolean; max: number | null };

/** Um registro por tabela, com as chaves estrangeiras apontando para os das outras. O esquema vem do catálogo do banco. */
async function seedDb(): Promise<void> {
  const columns = (await db.query<SeedColumn>(`
    SELECT c.table_name AS tbl, c.column_name AS name, c.data_type AS type, c.udt_name AS udt, c.is_nullable = 'YES' AS nullable,
      c.column_default IS NOT NULL AS defaulted, c.character_maximum_length AS max,
      c.is_identity = 'YES' OR c.is_generated = 'ALWAYS' OR coalesce(c.column_default, '') LIKE 'nextval(%' AS auto
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = c.table_schema
    WHERE c.table_schema = 'public' AND c.table_name <> '_prisma_migrations'
    ORDER BY c.table_name, c.ordinal_position`)).rows;
  const keys = (await db.query<{ tbl: string; col: string; kind: string; ref_tbl: string | null; ref_col: string | null }>(`
    SELECT t.relname AS tbl, a.attname AS col, k.contype::text AS kind, rt.relname AS ref_tbl, ra.attname AS ref_col
    FROM pg_constraint k
    JOIN pg_class t ON t.oid = k.conrelid AND t.relnamespace = 'public'::regnamespace
    JOIN unnest(k.conkey) WITH ORDINALITY AS own(attnum, pos) ON true
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = own.attnum
    LEFT JOIN unnest(k.confkey) WITH ORDINALITY AS ref(attnum, pos) ON ref.pos = own.pos
    LEFT JOIN pg_class rt ON rt.oid = k.confrelid
    LEFT JOIN pg_attribute ra ON ra.attrelid = k.confrelid AND ra.attnum = ref.attnum
    WHERE k.contype IN ('p', 'f')`)).rows;
  const labels = (await db.query<{ typname: string; label: string }>(
    `SELECT t.typname, e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid ORDER BY e.enumsortorder`
  )).rows;

  const keyOf = (c: SeedColumn, kind: string) => keys.find((k) => k.kind === kind && k.tbl === c.tbl && k.col === c.name);
  const isText = (c: SeedColumn) => c.type === 'text' || c.type.startsWith('character');
  /** O valor como texto do SQL: o Postgres converte para o tipo da coluna. */
  const value = (c: SeedColumn, seen: SeedColumn[] = []): string => {
    const fk = keyOf(c, 'f');
    const parent = fk && columns.find((x) => x.tbl === fk.ref_tbl && x.name === fk.ref_col);
    if (parent && !seen.includes(parent)) return value(parent, [...seen, c]);
    if (c.type === 'ARRAY' || c.type.startsWith('json')) return '{}';
    if (c.type === 'boolean') return 'true';
    if (c.type === 'uuid') return SEED_UUID;
    if (c.type === 'bytea') return '\\x00';
    if (c.type === 'date' || c.type.startsWith('timestamp')) return '2026-01-01 00:00:00+00';
    if (c.type.startsWith('time')) return '00:00:00';
    if (c.type === 'interval') return '1 day';
    if (c.type === 'USER-DEFINED') return labels.find((l) => l.typname === c.udt)?.label ?? SEED_TEXT;
    if (!isText(c)) return '1';
    const id = keyOf(c, 'p') && c.name.toLowerCase().endsWith('id');
    return (id ? '1' : SEED_TEXT).slice(0, c.max ?? undefined);
  };
  /** O que fica de fora: a sequência, o default, e o opcional que não é texto (um `deleted_at` preenchido esconderia o registro). */
  const filled = (c: SeedColumn) => {
    if (c.auto) return false;
    const fk = keyOf(c, 'f');
    if (fk) return !c.nullable || fk.ref_tbl !== c.tbl;
    return !!keyOf(c, 'p') || (!c.defaulted && (!c.nullable || isText(c)));
  };

  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
  // sem os gatilhos das chaves estrangeiras, a ordem das tabelas e os ciclos entre elas não importam
  await db.exec('SET session_replication_role = replica');
  try {
    for (const tbl of new Set(columns.map((c) => c.tbl))) {
      const cols = columns.filter((c) => c.tbl === tbl && filled(c));
      const values = cols.length ? `(${cols.map((c) => ident(c.name)).join(', ')}) VALUES (${cols.map((c) => literal(value(c))).join(', ')})` : 'DEFAULT VALUES';
      try {
        await db.exec(`INSERT INTO ${ident(tbl)} ${values}`);
      } catch (err) {
        console.warn(`chaos/db.ts: a tabela ${tbl} ficou sem registro de exemplo (${(err as Error).message}); escreva o INSERT no resetDb.`);
      }
    }
  } finally {
    await db.exec('SET session_replication_role = origin');
  }
}

/** Esvazia todas as tabelas, zera os ids e põe o registro de exemplo de cada uma. */
export async function resetDb(): Promise<void> {
  await ready;
  await db.exec(`DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE ' || quote_ident(t.tablename) || ' RESTART IDENTITY CASCADE';
    END LOOP;
  END $$;`);
  await seedDb();
  // ex.: outros dados de que o contrato precisa
  // await db.exec(`INSERT INTO category (name) VALUES ('Livros')`);
}
