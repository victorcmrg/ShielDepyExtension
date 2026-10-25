// O banco dos testes de caos que o `--init` gera (C2d): PGlite (o Postgres em WebAssembly, no mesmo
// processo) no lugar do driver que o app usa, com o esquema do próprio projeto. Só texto sai daqui;
// quem acha os `.sql` e grava os arquivos é a CLI. Hoje só o `pg`; o Prisma vem depois.
//
// O que a C1 ensinou (docs/pesquisa/caos-projetos-reais.md):
// - o PGlite responde sem devolver a vez ao event loop, e aí leitura e escrita de uma requisição rodam
//   juntas, antes de a próxima entrar: a corrida some. Um Postgres de verdade sempre devolve (a rede),
//   então o banco falso faz uma pausa (`setImmediate`) antes de cada consulta;
// - em CommonJS o `vi.mock('pg')` não alcança o `require()` nativo: o setup troca também o módulo em cache.

import type { AttackSurface } from './topology/surface';

export const CHAOS_DB_FILE = 'chaos/db.ts';
export const CHAOS_SETUP_FILE = 'chaos/setup.ts';
/** Onde o projeto escreve o esquema quando não tem nenhum `.sql` (o pg-crud da C1 não tinha). */
export const CHAOS_SCHEMA_FILE = 'chaos/schema.sql';

export interface ChaosDbPlan {
  driver: 'pg';
  /** `.sql` do esquema, relativos à raiz e com `/`, na ordem de aplicação. Vazio: o projeto não tem. */
  schemaFiles: string[];
  /** Tabelas que o mapa viu o app usar (só para orientar quem escreve o esquema). */
  tables: string[];
}

/** O driver do banco que o `--init` sabe trocar, pelo que a topologia viu (`pg`), ou nenhum. */
export function chaosDbPlan(surface: AttackSurface, sqlFiles: string[]): ChaosDbPlan | undefined {
  const ops = surface.routes.flatMap((r) => r.operations).filter((o) => o.via === 'pg' && o.kind !== 'api_call');
  if (ops.length === 0) return undefined;
  const tables = [...new Set(ops.map((o) => o.target).filter((t) => t !== 'dynamic' && t !== 'transaction'))].sort();
  return { driver: 'pg', schemaFiles: schemaFilesOf(sqlFiles), tables };
}

/**
 * Os `.sql` que montam o esquema: os que estão numa pasta `migrations` (ou `migration`), se houver;
 * senão todos. A ordem é a do caminho, que é a das migrations numeradas ou datadas.
 */
export function schemaFilesOf(sqlFiles: string[]): string[] {
  const files = sqlFiles.map((f) => f.split('\\').join('/')).filter((f) => f.toLowerCase().endsWith('.sql') && !f.startsWith('chaos/')).sort();
  const migrations = files.filter((f) => f.split('/').some((seg) => seg === 'migrations' || seg === 'migration'));
  return migrations.length > 0 ? migrations : files;
}

const list = (items: string[]) => `[${items.map((s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')}]`;

/** Os arquivos do banco de teste, por caminho relativo à raiz do projeto. */
export function chaosDbScaffold(plan: ChaosDbPlan): Record<string, string> {
  const schema = plan.schemaFiles.length > 0 ? plan.schemaFiles : [CHAOS_SCHEMA_FILE];
  const files: Record<string, string> = {
    [CHAOS_DB_FILE]: [
      '// Gerado pelo `shieldepy chaos --init`: o banco dos testes de caos. Pode editar (o --init não sobrescreve).',
      '// PGlite: o Postgres de verdade em WebAssembly, no mesmo processo. O app continua importando o `pg`;',
      '// o chaos/setup.ts troca o Pool e o Client dele pelos daqui.',
      "import { readFileSync } from 'node:fs';",
      "import { PGlite } from '@electric-sql/pglite';",
      '',
      'export const db = new PGlite();',
      '',
      '/** O esquema, relativo à raiz do projeto, na ordem de aplicação. */',
      `const SCHEMA = ${list(schema)};`,
      '',
      'const ready = (async () => {',
      "  for (const file of SCHEMA) await db.exec(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));",
      '})();',
      '',
      '// Um Postgres de verdade sempre devolve a vez ao event loop (a rede); o PGlite não. Sem esta pausa,',
      '// leitura e escrita de uma requisição rodam juntas e o teste de corrida passa num código que corre.',
      'const pause = () => new Promise<void>((resolve) => setImmediate(resolve));',
      '',
      'type Query = string | { text: string; values?: unknown[] };',
      'type Result = { rows: any[]; rowCount: number; fields: unknown[] };',
      'type Callback = (err: Error | null, result?: Result) => void;',
      '',
      '/** `query(text, values?)`, `query({ text, values })` e os dois com callback no fim, como no `pg`. */',
      'function run(q: Query, a?: unknown, b?: unknown): Promise<Result> | undefined {',
      "  const callback = (typeof a === 'function' ? a : b) as Callback | undefined;",
      "  const values = (typeof q === 'string' ? (Array.isArray(a) ? a : undefined) : (q.values ?? (Array.isArray(a) ? a : undefined))) as any[] | undefined;",
      '  const result = (async () => {',
      '    await ready;',
      '    await pause();',
      "    const r = await db.query(typeof q === 'string' ? q : q.text, values);",
      '    return { rows: r.rows as any[], rowCount: r.affectedRows ?? r.rows.length, fields: r.fields };',
      '  })();',
      '  if (!callback) return result;',
      '  result.then((r) => callback(null, r), (err) => callback(err));',
      '  return undefined;',
      '}',
      '',
      '// Uma conexão só: um BEGIN/COMMIT de um cliente vale para todos (o PGlite tem uma sessão).',
      'export class Client {',
      '  constructor(_config?: unknown) {}',
      '  async connect(): Promise<void> {}',
      '  query(q: Query, a?: unknown, b?: unknown) {',
      '    return run(q, a, b);',
      '  }',
      '  release(): void {}',
      '  async end(): Promise<void> {}',
      '  on(): this {',
      '    return this;',
      '  }',
      '}',
      '',
      'export class Pool {',
      '  constructor(_config?: unknown) {}',
      '  query(q: Query, a?: unknown, b?: unknown) {',
      '    return run(q, a, b);',
      '  }',
      '  async connect(): Promise<Client> {',
      '    return new Client();',
      '  }',
      '  async end(): Promise<void> {}',
      '  on(): this {',
      '    return this;',
      '  }',
      '}',
      '',
      '/** Esvazia todas as tabelas (e zera os ids). Os dados de que as requisições do contrato precisam entram depois. */',
      'export async function resetDb(): Promise<void> {',
      '  await ready;',
      '  await db.exec(`DO $$ DECLARE t record; BEGIN',
      "    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP",
      "      EXECUTE 'TRUNCATE ' || quote_ident(t.tablename) || ' RESTART IDENTITY CASCADE';",
      '    END LOOP;',
      '  END $$;`);',
      '  // ex.: o registro de id 1 que as rotas com :id do contrato usam',
      "  // await db.exec(`INSERT INTO category (name) VALUES ('Livros')`);",
      '}',
      '',
    ].join('\n'),
    [CHAOS_SETUP_FILE]: [
      '// Gerado pelo `shieldepy chaos --init`: carregado antes de cada teste de caos. O `pg` que o app usa',
      '// vira o banco de chaos/db.ts; nada no código do app muda.',
      "import { createRequire } from 'node:module';",
      "import { vi } from 'vitest';",
      "import { Client, Pool } from './db';",
      '',
      '// import (ESM e TypeScript): o Vitest troca o módulo',
      "vi.mock('pg', async () => {",
      "  const db = await import('./db');",
      '  return { Pool: db.Pool, Client: db.Client, default: { Pool: db.Pool, Client: db.Client } };',
      '});',
      '',
      '// require() (CommonJS): o vi.mock não alcança o require nativo; troca no módulo em cache, antes de o app carregar',
      "const pg = createRequire(import.meta.url)('pg');",
      'pg.Pool = Pool;',
      'pg.Client = Client;',
      '',
    ].join('\n'),
  };
  if (plan.schemaFiles.length === 0) {
    files[CHAOS_SCHEMA_FILE] = [
      '-- O projeto não tem .sql de esquema: escreva aqui os CREATE TABLE (o chaos/db.ts aplica este arquivo).',
      `-- Tabelas que o mapa viu o app usar: ${plan.tables.join(', ') || '(nenhuma com nome literal)'}.`,
      '',
    ].join('\n');
  }
  return files;
}
