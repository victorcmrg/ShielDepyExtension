// M1: os parâmetros de rota do contrato saem do registro que o resetDb gerado grava (decisão 0031).
import { describe, expect, it } from 'vitest';
import { chaosConfigPending, chaosConfigScaffold, chaosSeedFacts, type AttackSurface, type ChaosDbPlan } from '../src';

const db: ChaosDbPlan = { driver: 'pg', schemaFiles: [], tables: ['article'] };
const read = { kind: 'db_read', target: 'article', via: 'pg' };

/** Uma superfície com estas rotas `GET`; `ops` são as operações de todas. */
function surface(paths: string[], ops: object[] = [read]): AttackSurface {
  return {
    version: 1,
    topologyHash: 'x',
    collisions: [],
    routes: paths.map((path) => ({ id: `GET ${path}`, method: 'GET', path, at: 'src/a.ts:1', operations: ops })),
  } as unknown as AttackSurface;
}
const line = (source: string, route: string) => source.split('\n').find((l) => l.includes(`'GET ${route}'`))!;

describe('M1 — o parâmetro de rota pelo registro de exemplo', () => {
  const sql = chaosSeedFacts({ sql: ['CREATE TABLE "Article" ("id" SERIAL, "slug" TEXT, user_name TEXT);'] });

  it('o id, com qualquer prefixo, vira 1 sem pendência, mesmo sem o esquema escrito', () => {
    const source = chaosConfigScaffold(surface(['/a/:id', '/b/:categoryId', '/c/:user_id']), { db, seed: chaosSeedFacts({ sql: [] }) });
    expect(line(source, '/a/:id')).toContain("{ path: '/a/1' }, // parâmetro pelo registro de exemplo do chaos/db.ts (confira)");
    expect(line(source, '/b/:categoryId')).toContain("path: '/b/1'");
    expect(line(source, '/c/:user_id')).toContain("path: '/c/1'");
    // sobram o createApp (aqui sem app) e o esquema, que o projeto não tem
    expect(chaosConfigPending(source)).toBe(2);
  });

  it('o parâmetro de texto vira registro-1 quando o nome existe no esquema, com aspas ou em outra grafia', () => {
    const source = chaosConfigScaffold(surface(['/a/:slug/c/:id', '/u/:userName']), { db, seed: sql });
    expect(line(source, '/a/:slug/c/:id')).toContain("path: '/a/registro-1/c/1'");
    expect(line(source, '/u/:userName')).toContain("path: '/u/registro-1'");
    expect(source).not.toContain('confira o parâmetro');
  });

  it('o nome que o esquema não tem continua pendência, e sem esquema também', () => {
    const known = chaosConfigScaffold(surface(['/a/:token']), { db, seed: sql });
    expect(line(known, '/a/:token')).toContain("path: '/a/1' }, // TODO(shieldepy): confira o parâmetro");
    const unknown = chaosConfigScaffold(surface(['/a/:slug']), { db, seed: chaosSeedFacts({ sql: [] }) });
    expect(line(unknown, '/a/:slug')).toContain('TODO(shieldepy): confira o parâmetro');
  });

  it('com coluna uuid no projeto, o id continua pendência: o 1 pode não ser um valor válido', () => {
    const uuid = chaosSeedFacts({ sql: ['CREATE TABLE a (id UUID PRIMARY KEY DEFAULT gen_random_uuid());'] });
    expect(uuid.uuid).toBe(true);
    expect(line(chaosConfigScaffold(surface(['/a/:id']), { db, seed: uuid }), '/a/:id')).toContain('TODO(shieldepy): confira o parâmetro');
    // no Prisma, `uuid()` é a função do default (a coluna é TEXT, e o id 1 vale); `@db.Uuid` é o tipo
    expect(chaosSeedFacts({ sql: [], prisma: 'model A {\n  id String @id @default(uuid())\n}\n' }).uuid).toBe(false);
    expect(chaosSeedFacts({ sql: [], prisma: 'model A {\n  id String @id @db.Uuid\n}\n' }).uuid).toBe(true);
    // o nome de uma função ou de uma extensão não conta
    expect(chaosSeedFacts({ sql: ['CREATE EXTENSION "uuid-ossp"; SELECT gen_random_uuid();'] }).uuid).toBe(false);
  });

  it('o schema.prisma serve quando não há SQL: o nome do campo vale como coluna', () => {
    const facts = chaosSeedFacts({ sql: [], prisma: 'model Article {\n  slug String @unique\n}\n' });
    expect(line(chaosConfigScaffold(surface(['/a/:slug']), { db, seed: facts }), '/a/:slug')).toContain("path: '/a/registro-1'");
  });

  it('a rota que não usa este banco não tem registro: a pendência fica', () => {
    const api = [{ kind: 'api_call', target: 'api.exemplo.com', via: 'fetch' }];
    expect(line(chaosConfigScaffold(surface(['/a/:id'], api), { db, seed: sql }), '/a/:id')).toContain('TODO(shieldepy): confira o parâmetro');
    const mongo = [{ kind: 'db_read', target: 'article', via: 'mongoose' }];
    expect(line(chaosConfigScaffold(surface(['/a/:id'], mongo), { db, seed: sql }), '/a/:id')).toContain('TODO(shieldepy): confira o parâmetro');
  });

  it('sem o registro (o chaos/db.ts do projeto não tem o seedDb) e no curinga, a pendência fica', () => {
    expect(line(chaosConfigScaffold(surface(['/a/:id']), { db }), '/a/:id')).toContain('TODO(shieldepy): confira o parâmetro');
    expect(line(chaosConfigScaffold(surface(['/a/:id/*']), { db, seed: sql }), '/a/:id/*')).toContain("path: '/a/1/x' }, // TODO(shieldepy): confira o parâmetro");
  });

  it('a linha com corpo junta os dois comentários', () => {
    const put = { ...surface(['/a/:id']).routes[0]!, id: 'PUT /a/:id', method: 'PUT' };
    const source = chaosConfigScaffold({ ...surface([]), routes: [put] }, { db, seed: sql, bodies: { 'PUT /a/:id': { paths: ['name'], from: ['update'] } } });
    expect(source).toContain("'PUT /a/:id': { path: '/a/1', body: { name: 'teste' } }, // corpo pelos campos que update lê (confira os valores); parâmetro pelo registro de exemplo do chaos/db.ts (confira) (src/a.ts:1)");
  });
});
