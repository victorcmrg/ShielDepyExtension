// Gerado pelo `shieldepy chaos --init`: o banco dos testes de caos. Pode editar (o --init não sobrescreve).
// PGlite: o Postgres de verdade em WebAssembly, no mesmo processo, servido pelo protocolo do Postgres
// numa porta livre (pglite-socket). O Prisma do app não muda: só a URL do banco aponta para cá, antes
// de o app carregar (o chaos/setup.ts importa este arquivo primeiro).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

export const db = new PGlite();

/** O esquema, relativo à raiz do projeto, na ordem de aplicação. */
const SCHEMA = ['chaos/schema.sql'];

const ready = (async () => {
  for (const file of SCHEMA) await db.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
})();

// Várias conexões ao mesmo PGlite: o servidor põe as consultas numa fila, e uma transação aberta só
// deixa passar as da conexão dela. A rede devolve a vez ao event loop a cada consulta, e é isso que
// deixa a corrida aparecer (o banco do `pg` precisa de uma pausa de propósito).
const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 20 });
await ready;
await server.start();

// connection_limit=1: o motor do Prisma 4 a 6 abre conexões novas devagar, e a primeira requisição
// terminava sozinha antes de as outras entrarem (o teste de corrida passava num código que corre).
// Com uma conexão, as consultas entram na fila na ordem em que chegam. O Prisma 7 (com o
// @prisma/adapter-pg) usa o pool do `pg`, que ignora o parâmetro: ali a conexão única vem do Pool abaixo.
const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable&connection_limit=1`;
for (const name of ['DATABASE_URL']) process.env[name] = url;

// Prisma 7: o adapter cria o pool com `new pg.Pool(...)`; trocado no módulo em cache, ele sai com uma
// conexão só (sem isso, a segunda requisição esperava abrir uma conexão nova e a corrida sumia).
try {
  const pg = createRequire(import.meta.url)('pg') as { Pool: new (options?: object) => object };
  const Pool = pg.Pool;
  pg.Pool = class extends (Pool as new (options?: object) => object) {
    constructor(options: object = {}) {
      super({ ...options, max: 1 });
    }
  };
} catch {
  // sem o `pg` instalado: Prisma 4 a 6, com o motor próprio
}

/** Esvazia todas as tabelas (e zera os ids). Os dados de que as requisições do contrato precisam entram depois. */
export async function resetDb(): Promise<void> {
  await ready;
  await db.exec(`DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
      EXECUTE 'TRUNCATE ' || quote_ident(t.tablename) || ' RESTART IDENTITY CASCADE';
    END LOOP;
  END $$;`);
  // o usuário e o post de id 1 que as rotas do contrato usam
  await db.exec(`INSERT INTO "User" (email, name) VALUES ('teste@exemplo.com', 'Ana');
    INSERT INTO "Post" (title, content, published, "authorId", "updatedAt") VALUES ('Primeiro', 'texto', false, 1, now());`);
}
