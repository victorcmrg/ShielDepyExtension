// Banco dos testes: Postgres de verdade em WASM (PGlite), no mesmo processo — SQL com a semântica
// real, sem servidor. Os testes trocam o `pg` pelo `Pool` daqui (ver `setup.ts`): o código do app
// não muda, e a corrida entre `await`s (lê → chama o Stripe → escreve) acontece igual.
// (pg-mem foi descartado: na 3.0.14, repetir o mesmo UPDATE parametrizado dava valores errados.)
import { PGlite } from '@electric-sql/pglite';

export const db = new PGlite();

const ready = db.exec(`
  CREATE TABLE stock (product_id TEXT PRIMARY KEY, quantity INTEGER NOT NULL);
  CREATE TABLE orders (id SERIAL PRIMARY KEY, product_id TEXT NOT NULL, quantity INTEGER NOT NULL, charge_id TEXT NOT NULL);
`);

/** O pedaço do `pg.Pool` que o app usa (`query`, `connect`), sobre o PGlite. */
export class Pool {
  async query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number }> {
    await ready;
    const result = await db.query(text, values);
    return { rows: result.rows as any[], rowCount: result.affectedRows ?? result.rows.length };
  }

  async connect(): Promise<{ query: Pool['query']; release(): void }> {
    return { query: (text, values) => this.query(text, values), release: () => undefined };
  }

  async end(): Promise<void> {}
}

/** Banco vazio com o estoque pedido (`{ 'p-1': 1 }` = o último item). */
export async function resetDb(stock: Record<string, number>): Promise<void> {
  await ready;
  await db.exec('TRUNCATE orders RESTART IDENTITY; DELETE FROM stock;');
  for (const [product, quantity] of Object.entries(stock)) {
    await db.query('INSERT INTO stock (product_id, quantity) VALUES ($1, $2)', [product, quantity]);
  }
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
