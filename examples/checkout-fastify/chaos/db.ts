// Gerado pelo `shieldepy chaos --init`: o banco dos testes de caos. Pode editar (o --init não sobrescreve).
// PGlite: o Postgres de verdade em WebAssembly, no mesmo processo. O app continua importando o `pg`;
// o chaos/setup.ts troca o Pool e o Client dele pelos daqui.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const db = new PGlite();

/** O esquema, relativo à raiz do projeto, na ordem de aplicação. */
const SCHEMA = ['chaos/schema.sql'];

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

/** Esvazia todas as tabelas (e zera os ids). Os dados de que as requisições do contrato precisam entram depois. */
export async function resetDb(): Promise<void> {
  await ready;
  await db.exec(`DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE ' || quote_ident(t.tablename) || ' RESTART IDENTITY CASCADE';
    END LOOP;
  END $$;`);
  // o último item em estoque: o cenário em que a corrida aparece
  await db.exec(`INSERT INTO stock (product_id, quantity) VALUES ('p-1', 1)`);
}

/** Menor estoque do banco (negativo = vendeu o que não tinha). */
export async function minStock(): Promise<number> {
  const { rows } = await db.query<{ m: number }>('SELECT MIN(quantity) AS m FROM stock');
  return rows[0]!.m;
}

/** Quantos pedidos foram gravados. */
export async function orderCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM orders');
  return rows[0]!.n;
}
