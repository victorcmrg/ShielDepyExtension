// O banco de teste que o `--init` gera (C2d), executado de verdade: o chaos/db.ts gerado vai para uma
// pasta ignorada pelo git dentro do repositório (para achar o @electric-sql/pglite da raiz) e é importado.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaosDbScaffold } from '../src';

const dir = path.join(__dirname, '.shieldepy', `c2d-${process.pid}`);

type Result = { rows: any[]; rowCount: number };
type Db = {
  Pool: new () => { query(q: unknown, a?: unknown, b?: unknown): Promise<Result> | undefined; connect(): Promise<{ query(q: string): Promise<Result>; release(): void }> };
  resetDb(): Promise<void>;
};
let mod: Db;

beforeAll(async () => {
  const files = chaosDbScaffold({ driver: 'pg', schemaFiles: ['migrations/001_category.sql'], tables: ['category'] });
  files['migrations/001_category.sql'] = 'CREATE TABLE category (id SERIAL PRIMARY KEY, name TEXT NOT NULL);';
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  mod = (await import(pathToFileURL(path.join(dir, 'chaos', 'db.ts')).href)) as Db;
}, 60000);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('C2d — o banco de teste gerado', () => {
  it('a corrida aparece: dois "checa se existe e insere" simultâneos inserem os dois (como num Postgres de verdade)', async () => {
    await mod.resetDb();
    const pool = new mod.Pool();
    const create = async () => {
      const exists = await pool.query({ text: 'SELECT EXISTS (SELECT 1 FROM category WHERE name = $1)', values: ['Livros'] });
      if (exists!.rows[0].exists) return 409;
      await pool.query('INSERT INTO category (name) VALUES ($1)', ['Livros']);
      return 201;
    };
    // a segunda requisição chega numa volta seguinte do event loop, como no HTTP. Sem a pausa antes de
    // cada consulta, o PGlite terminava a primeira inteira antes disso e saía [201, 409] (C1, pg-crud)
    const later = new Promise<void>((resolve) => setImmediate(resolve)).then(create);
    expect(await Promise.all([create(), later])).toEqual([201, 201]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM category'))!.rows[0].n).toBe(2);
  });

  it('fala como o pg: callback no fim, connect/release e rowCount de escrita', async () => {
    await mod.resetDb();
    const pool = new mod.Pool();
    const viaCallback = await new Promise<Result>((resolve, reject) =>
      pool.query('INSERT INTO category (name) VALUES ($1), ($2)', ['a', 'b'], (err: Error | null, r?: Result) => (err ? reject(err) : resolve(r!)))
    );
    expect(viaCallback.rowCount).toBe(2);
    const client = await pool.connect();
    expect((await client.query('SELECT name FROM category ORDER BY id')).rows.map((r) => r.name)).toEqual(['a', 'b']);
    client.release();
  });

  it('o reset esvazia as tabelas e zera os ids', async () => {
    const pool = new mod.Pool();
    await pool.query("INSERT INTO category (name) VALUES ('x')");
    await mod.resetDb();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM category'))!.rows[0].n).toBe(0);
    expect((await pool.query("INSERT INTO category (name) VALUES ('y') RETURNING id"))!.rows[0].id).toBe(1);
  });
});
