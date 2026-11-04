// O banco de teste que o `--init` gera (C2d), executado de verdade: o chaos/db.ts gerado vai para uma
// pasta ignorada pelo git dentro do repositório (para achar o @electric-sql/pglite da raiz) e é importado.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
    // os dois, mais o registro de exemplo do reset
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM category'))!.rows[0].n).toBe(3);
  });

  it('fala como o pg: callback no fim, connect/release e rowCount de escrita', async () => {
    await mod.resetDb();
    const pool = new mod.Pool();
    const viaCallback = await new Promise<Result>((resolve, reject) =>
      pool.query('INSERT INTO category (name) VALUES ($1), ($2)', ['a', 'b'], (err: Error | null, r?: Result) => (err ? reject(err) : resolve(r!)))
    );
    expect(viaCallback.rowCount).toBe(2);
    const client = await pool.connect();
    expect((await client.query('SELECT name FROM category ORDER BY id')).rows.map((r) => r.name)).toEqual(['registro-1', 'a', 'b']);
    client.release();
  });

  it('o reset esvazia as tabelas e zera os ids: sobra o registro 1, e o próximo do app é o 2 (sem conflito na sequência)', async () => {
    const pool = new mod.Pool();
    await pool.query("INSERT INTO category (name) VALUES ('x')");
    await mod.resetDb();
    expect((await pool.query('SELECT id, name FROM category'))!.rows).toEqual([{ id: 1, name: 'registro-1' }]);
    expect((await pool.query("INSERT INTO category (name) VALUES ('y') RETURNING id"))!.rows[0].id).toBe(2);
  });
});

// M1: os registros que as rotas com :id e :slug do contrato buscam. O esquema é lido do catálogo do
// próprio banco, então vale para as migrations do projeto e para o esquema escrito à mão.
describe('M1 — o registro de exemplo de cada tabela', () => {
  type Seeded = Pick<Db, 'resetDb'> & { db: { query(q: string): Promise<{ rows: any[] }>; exec(q: string): Promise<unknown> } };
  const schema = `
    CREATE TYPE role AS ENUM ('member', 'admin');
    CREATE TABLE "User" (
      id SERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, role role NOT NULL, bio TEXT, born DATE,
      "updatedAt" TIMESTAMP(3) NOT NULL, tags TEXT[] NOT NULL, prefs JSONB NOT NULL, age INT NOT NULL, ok BOOLEAN NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), shout TEXT GENERATED ALWAYS AS (upper(username)) STORED
    );
    CREATE TABLE article (
      uid UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR(40) UNIQUE,
      "authorId" INT NOT NULL REFERENCES "User"(id), parent UUID REFERENCES article(uid), code CHAR(4) NOT NULL
    );
    CREATE TABLE note (id TEXT PRIMARY KEY, "articleUid" UUID NOT NULL REFERENCES article(uid), owner INT REFERENCES "User"(id));
    CREATE TABLE "_ArticleToNote" ("A" UUID NOT NULL REFERENCES article(uid), "B" TEXT NOT NULL REFERENCES note(id));
    CREATE TABLE counter (id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, n INT NOT NULL DEFAULT 0);
    CREATE TABLE ticket (code TEXT PRIMARY KEY, seat INT NOT NULL CHECK (seat > 100));
    CREATE TABLE cycle_a (id SERIAL PRIMARY KEY, b INT);
    CREATE TABLE cycle_b (id SERIAL PRIMARY KEY, a INT NOT NULL REFERENCES cycle_a(id));
    ALTER TABLE cycle_a ADD CONSTRAINT a_b FOREIGN KEY (b) REFERENCES cycle_b(id);
  `;
  let mod: Seeded;
  const rows = async (sql: string) => (await mod.db.query(sql)).rows;
  beforeAll(async () => {
    mod = (await generate('seed', { driver: 'pg', schemaFiles: ['schema.sql'], tables: [] }, { 'schema.sql': schema })) as Seeded;
  }, 60000);

  it('cada tabela ganha um registro, com o id 1 ou o texto registro-1, e os tipos do esquema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.resetDb();
    warn.mockRestore();
    const [user] = await rows('SELECT * FROM "User"');
    expect(user).toMatchObject({ id: 1, username: 'registro-1', role: 'member', bio: 'registro-1', born: null, tags: [], prefs: {}, age: 1, ok: true, shout: 'REGISTRO-1' });
    expect(user.updatedAt).toBeInstanceOf(Date);
    expect(await rows('SELECT id, n FROM counter')).toEqual([{ id: 1, n: 0 }]);
  });

  it('as chaves estrangeiras apontam para os registros das outras tabelas, e a coluna opcional que aponta para a própria tabela fica vazia', async () => {
    await mod.resetDb();
    const [article] = await rows('SELECT * FROM article');
    expect(article).toMatchObject({ uid: '00000000-0000-4000-8000-000000000001', slug: 'registro-1', authorId: 1, parent: null, code: 'regi' });
    expect(await rows('SELECT id, "articleUid", owner FROM note')).toEqual([{ id: '1', articleUid: article.uid, owner: 1 }]);
    expect(await rows('SELECT "A", "B" FROM "_ArticleToNote"')).toEqual([{ A: article.uid, B: '1' }]);
    expect(await rows('SELECT a.id FROM cycle_a a JOIN cycle_b b ON a.b = b.id AND b.a = a.id')).toEqual([{ id: 1 }]);
  });

  it('a tabela que recusa o registro fica vazia, com um aviso, e o resto do banco segue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mod.resetDb();
    expect(warn.mock.calls.flat().join(' ')).toContain('ticket');
    warn.mockRestore();
    expect(await rows('SELECT * FROM ticket')).toEqual([]);
    expect(await rows('SELECT id FROM "User"')).toEqual([{ id: 1 }]);
  });

  it('as chaves estrangeiras voltam a valer depois do reset, e as sequências seguem do registro 1', async () => {
    await mod.resetDb();
    await expect(mod.db.exec(`INSERT INTO cycle_b (a) VALUES (999)`)).rejects.toThrow(/foreign key/);
    expect(await rows(`INSERT INTO cycle_a DEFAULT VALUES RETURNING id`)).toEqual([{ id: 2 }]);
    expect(await rows(`INSERT INTO counter DEFAULT VALUES RETURNING id`)).toEqual([{ id: 2 }]);
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

  it('o registro de exemplo sai com o Prisma ligado: as escritas seguem pela mesma sessão do socket', async () => {
    await mod.resetDb();
    expect((await pool.query(`SELECT current_setting('session_replication_role') AS role`)).rows[0].role).toBe('origin');
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
    expect((await outside).rows[0].n).toBe(2);
    await Promise.all([tx.end(), other.end()]);
  });

  it('o reset esvazia as tabelas do app, zera os ids e mantém o _prisma_migrations', async () => {
    await pool.query(`INSERT INTO "User" (email) VALUES ('x@x.com')`);
    await mod.resetDb();
    expect((await pool.query('SELECT id, email FROM "User"')).rows).toEqual([{ id: 1, email: 'registro-1' }]);
    expect((await pool.query(`INSERT INTO "User" (email) VALUES ('y@y.com') RETURNING id`)).rows[0].id).toBe(2);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM "_prisma_migrations"')).rows[0].n).toBe(1);
  });
});
