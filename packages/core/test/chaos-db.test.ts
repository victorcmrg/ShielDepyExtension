// O banco de teste que o `--init` gera (C2d), executado de verdade: o chaos/db.ts gerado vai para uma
// pasta ignorada pelo git dentro do repositório (para achar o @electric-sql/pglite da raiz) e é importado.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaosDbScaffold, type ChaosDbPlan } from '../src';

const dir = path.join(__dirname, '.shieldepy', `c2d-${process.pid}`);

/** Grava os arquivos gerados (mais os do "projeto") numa pasta própria e importa o chaos/db.ts. */
async function generate(name: string, plan: ChaosDbPlan, project: Record<string, string>): Promise<unknown> {
  const files = { ...chaosDbScaffold(plan), ...project };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, name, rel), text);
  }
  return import(pathToFileURL(path.join(dir, name, 'chaos', 'db.ts')).href);
}
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Result = { rows: any[]; rowCount: number };
type Db = {
  Pool: new () => { query(q: unknown, a?: unknown, b?: unknown): Promise<Result> | undefined; connect(): Promise<{ query(q: string): Promise<Result>; release(): void }> };
  resetDb(): Promise<void>;
};

describe('C2d — o banco de teste gerado (pg)', () => {
  let mod: Db;
  beforeAll(async () => {
    const plan: ChaosDbPlan = { driver: 'pg', schemaFiles: ['migrations/001_category.sql'], tables: ['category'] };
    mod = (await generate('pg', plan, { 'migrations/001_category.sql': 'CREATE TABLE category (id SERIAL PRIMARY KEY, name TEXT NOT NULL);' })) as Db;
  }, 60000);

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

// O Prisma fala com o banco pela rede: aqui quem conecta é o `pg` de verdade, pela mesma URL que o
// Prisma do app receberia (o Prisma em si foi conferido nos projetos da C1: realworld e prisma-express).
describe('C2d2 — o banco de teste gerado (Prisma, pelo pglite-socket)', () => {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, SHIELDEPY_DIRECT_URL: process.env.SHIELDEPY_DIRECT_URL };
  let mod: Pick<Db, 'resetDb'>;
  let pool: pg.Pool;
  beforeAll(async () => {
    const plan: ChaosDbPlan = {
      driver: 'prisma',
      schemaFiles: ['prisma/migrations/20240101_init/migration.sql'],
      tables: ['user'],
      prisma: { schema: 'prisma/schema.prisma', envVars: ['DATABASE_URL', 'SHIELDEPY_DIRECT_URL'] },
    };
    const migration = [
      'CREATE TABLE "User" ("id" SERIAL NOT NULL PRIMARY KEY, "email" TEXT NOT NULL);',
      'CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY);',
      `INSERT INTO "_prisma_migrations" VALUES ('20240101_init');`,
    ].join('\n');
    mod = (await generate('prisma', plan, { 'prisma/migrations/20240101_init/migration.sql': migration })) as Pick<Db, 'resetDb'>;
    // como o @prisma/adapter-pg do Prisma 7 cria o dele (o chaos/db.ts trocou o Pool do `pg`)
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  }, 60000);
  afterAll(async () => {
    await pool?.end();
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('importar o chaos/db.ts sobe o banco e aponta as variáveis do datasource para ele', async () => {
    expect(process.env.DATABASE_URL).toMatch(/^postgresql:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres\?sslmode=disable&connection_limit=1$/);
    expect(process.env.SHIELDEPY_DIRECT_URL).toBe(process.env.DATABASE_URL);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM "User"')).rows[0].n).toBe(0);
  });

  it('a corrida aparece: uma conexão só no pool, e as consultas entram na fila na ordem em que chegam', async () => {
    expect((pool as unknown as { options: { max: number } }).options.max).toBe(1);
    await mod.resetDb();
    // sem a conexão única, a segunda requisição esperava abrir uma conexão nova, a primeira terminava
    // sozinha e saía [201, 409]: o mesmo falso verde do motor do Prisma 4 sem o connection_limit=1
    const create = async () => {
      const exists = await pool.query('SELECT EXISTS (SELECT 1 FROM "User" WHERE email = $1)', ['a@a.com']);
      if (exists.rows[0].exists) return 409;
      await pool.query('INSERT INTO "User" (email) VALUES ($1)', ['a@a.com']);
      return 201;
    };
    const later = new Promise<void>((resolve) => setImmediate(resolve)).then(create);
    expect(await Promise.all([create(), later])).toEqual([201, 201]);
  });

  it('uma transação aberta numa conexão segura as consultas das outras até o COMMIT', async () => {
    await mod.resetDb();
    // duas conexões de verdade ao socket (o pool só tem uma): o PGlite tem uma sessão, e o servidor
    // não deixa a consulta de fora entrar no meio da transação
    const tx = new pg.Client({ connectionString: process.env.DATABASE_URL });
    const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await Promise.all([tx.connect(), other.connect()]);
    await tx.query('BEGIN');
    await tx.query(`INSERT INTO "User" (email) VALUES ('t@t.com')`);
    const outside = other.query('SELECT COUNT(*)::int AS n FROM "User"');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await tx.query('COMMIT');
    expect((await outside).rows[0].n).toBe(1);
    await Promise.all([tx.end(), other.end()]);
  });

  it('o reset esvazia as tabelas do app, zera os ids e mantém o _prisma_migrations', async () => {
    await pool.query(`INSERT INTO "User" (email) VALUES ('x@x.com')`);
    await mod.resetDb();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM "User"')).rows[0].n).toBe(0);
    expect((await pool.query(`INSERT INTO "User" (email) VALUES ('y@y.com') RETURNING id`)).rows[0].id).toBe(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM "_prisma_migrations"')).rows[0].n).toBe(1);
  });
});
