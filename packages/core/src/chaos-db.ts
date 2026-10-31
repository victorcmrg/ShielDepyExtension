// O banco dos testes de caos que o `--init` gera (C2d): PGlite (o Postgres em WebAssembly, no mesmo
// processo) no lugar do banco que o app usa, com o esquema do próprio projeto. Só texto sai daqui;
// quem acha os `.sql` e o `schema.prisma`, roda o `prisma migrate diff` e grava os arquivos é a CLI.
//
// O que a C1 ensinou (docs/pesquisa/caos-projetos-reais.md):
// - o PGlite responde sem devolver a vez ao event loop, e aí leitura e escrita de uma requisição rodam
//   juntas, antes de a próxima entrar: a corrida some. Um Postgres de verdade sempre devolve (a rede),
//   então o `pg` falso faz uma pausa (`setImmediate`) antes de cada consulta;
// - em CommonJS o `vi.mock('pg')` não alcança o `require()` nativo: o setup troca também o módulo em cache.
//
// No Prisma (C2d2, decisão 0019), o app não muda: o PGlite é servido pelo protocolo do Postgres numa
// porta livre (`pglite-socket`), e a `DATABASE_URL` aponta para lá. Vale do Prisma 4 ao 7, e a rede
// já faz a pausa.

import type { AttackSurface } from './topology/surface';

export const CHAOS_DB_FILE = 'chaos/db.ts';
export const CHAOS_SETUP_FILE = 'chaos/setup.ts';
/** Onde fica o esquema quando o projeto não tem `.sql` (o pg-crud da C1) nem migrations do Prisma. */
export const CHAOS_SCHEMA_FILE = 'chaos/schema.sql';

export interface ChaosPrismaPlan {
  /** O `schema.prisma` (relativo à raiz, com `/`). */
  schema: string;
  /** As variáveis de ambiente da URL do banco (`url` e `directUrl` do `datasource`); sem elas, `DATABASE_URL`. */
  envVars: string[];
  /** Sem migrations: o comando que gera o SQL do esquema e, se a CLI conseguiu rodá-lo, o SQL. */
  diff?: { command: string; sql?: string };
}

export interface ChaosDbPlan {
  driver: 'pg' | 'prisma';
  /** `.sql` do esquema, relativos à raiz e com `/`, na ordem de aplicação. Vazio: o projeto não tem. */
  schemaFiles: string[];
  /** Tabelas que o mapa viu o app usar (só para orientar quem escreve o esquema). */
  tables: string[];
  prisma?: ChaosPrismaPlan;
}

/** Um `schema.prisma` do projeto: caminho relativo à raiz e o texto. */
export interface PrismaSchemaFile {
  file: string;
  text: string;
}

const slash = (f: string) => f.split('\\').join('/');

/**
 * O banco que o `--init` sabe trocar, pelo que a topologia viu, ou nenhum. Com Prisma e `pg` no mesmo
 * app, vence o Prisma (o `pg` direto fica de fora do banco de teste). `files` são os arquivos do
 * projeto (relativos à raiz); `prismaSchemas`, os `.prisma` lidos pela CLI.
 */
export function chaosDbPlan(surface: AttackSurface, files: string[], prismaSchemas: PrismaSchemaFile[] = []): ChaosDbPlan | undefined {
  const ops = surface.routes.flatMap((r) => r.operations).filter((o) => o.kind !== 'api_call');
  const tablesOf = (via: string) =>
    [...new Set(ops.filter((o) => o.via === via).map((o) => o.target).filter((t) => t !== 'dynamic' && t !== 'transaction'))].sort();
  const schema = ops.some((o) => o.via === 'prisma') ? pickPrismaSchema(prismaSchemas) : undefined;
  if (schema) {
    const dir = schema.file.includes('/') ? schema.file.slice(0, schema.file.lastIndexOf('/') + 1) : '';
    const migrations = files
      .map(slash)
      .filter((f) => f.startsWith(`${dir}migrations/`) && f.endsWith('/migration.sql'))
      .sort();
    const envVars = prismaDatasourceEnv(schema.text);
    return { driver: 'prisma', schemaFiles: migrations, tables: tablesOf('prisma'), prisma: { schema: schema.file, envVars: envVars.length ? envVars : ['DATABASE_URL'] } };
  }
  if (!ops.some((o) => o.via === 'pg')) return undefined;
  return { driver: 'pg', schemaFiles: schemaFilesOf(files), tables: tablesOf('pg') };
}

/**
 * O `schema.prisma` do app: o que declara um `datasource`, preferindo o chamado `schema.prisma` e, entre
 * eles, o mais raso (o `prisma-client-js` com `output` próprio copia o esquema para a pasta do cliente).
 */
function pickPrismaSchema(schemas: PrismaSchemaFile[]): PrismaSchemaFile | undefined {
  const named = (s: PrismaSchemaFile) => s.file.split('/').pop() === 'schema.prisma';
  const depth = (s: PrismaSchemaFile) => s.file.split('/').length;
  const candidates = schemas.map((s) => ({ ...s, file: slash(s.file) })).filter((s) => !s.file.startsWith('chaos/'));
  const withSource = candidates.filter((s) => prismaTokens(s.text).some((t) => t === 'datasource'));
  const pool = withSource.length ? withSource : candidates;
  return [...pool].sort((a, b) => Number(named(b)) - Number(named(a)) || depth(a) - depth(b) || a.file.localeCompare(b.file))[0];
}

const isIdentStart = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isIdentPart = (c: string) => isIdentStart(c) || (c >= '0' && c <= '9');

/**
 * Os tokens de um `schema.prisma` (analisador léxico, sem regex: decisão 0002). Identificadores e
 * pontuação saem como estão; strings saem com as aspas (`"DATABASE_URL"`); comentários somem.
 */
export function prismaTokens(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++;
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i, j + 1));
      i = j + 1;
    } else if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentPart(text[j]!)) j++;
      out.push(text.slice(i, j));
      i = j;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

/** As variáveis de `url = env("X")` e `directUrl = env("Y")` dos blocos `datasource`, na ordem. */
export function prismaDatasourceEnv(text: string): string[] {
  const t = prismaTokens(text);
  const vars: string[] = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== 'datasource' || t[i + 2] !== '{') continue;
    let depth = 0;
    for (let j = i + 2; j < t.length; j++) {
      if (t[j] === '{') depth++;
      else if (t[j] === '}' && --depth === 0) break;
      else if ((t[j] === 'url' || t[j] === 'directUrl') && t[j + 1] === '=' && t[j + 2] === 'env' && t[j + 3] === '(' && t[j + 4]?.startsWith('"')) {
        const name = t[j + 4]!.slice(1, -1);
        if (name && !vars.includes(name)) vars.push(name);
      }
    }
  }
  return vars;
}

/**
 * Os `.sql` que montam o esquema: os que estão numa pasta `migrations` (ou `migration`), se houver;
 * senão todos. A ordem é a do caminho, que é a das migrations numeradas ou datadas.
 */
export function schemaFilesOf(sqlFiles: string[]): string[] {
  const files = sqlFiles.map(slash).filter((f) => f.toLowerCase().endsWith('.sql') && !f.startsWith('chaos/')).sort();
  const migrations = files.filter((f) => f.split('/').some((seg) => seg === 'migrations' || seg === 'migration'));
  return migrations.length > 0 ? migrations : files;
}

/** Falta escrever o esquema à mão: sem `.sql` no projeto e sem o SQL do `prisma migrate diff`. */
export const chaosSchemaPending = (plan: ChaosDbPlan) => plan.schemaFiles.length === 0 && !plan.prisma?.diff?.sql;

const list = (items: string[]) => `[${items.map((s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(', ')}]`;

const RESET_DB = [
  '/** Esvazia todas as tabelas (e zera os ids). Os dados de que as requisições do contrato precisam entram depois. */',
  'export async function resetDb(): Promise<void> {',
  '  await ready;',
  '  await db.exec(`DO $$ DECLARE t record; BEGIN',
  "    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP",
  "      EXECUTE 'TRUNCATE ' || quote_ident(t.tablename) || ' RESTART IDENTITY CASCADE';",
  '    END LOOP;',
  '  END $$;`);',
];

/**
 * Os arquivos do banco de teste, por caminho relativo à raiz do projeto. A troca do `pg` fica no setup
 * (`chaosSetupScaffold`); no Prisma, importar o chaos/db.ts já sobe o banco e aponta a URL.
 */
export function chaosDbScaffold(plan: ChaosDbPlan): Record<string, string> {
  const schema = plan.schemaFiles.length > 0 ? plan.schemaFiles : [CHAOS_SCHEMA_FILE];
  const files: Record<string, string> = { [CHAOS_DB_FILE]: plan.driver === 'prisma' ? prismaDb(plan, schema) : pgDb(schema) };
  if (plan.schemaFiles.length === 0) files[CHAOS_SCHEMA_FILE] = schemaSql(plan);
  return files;
}

function schemaSql(plan: ChaosDbPlan): string {
  const diff = plan.prisma?.diff;
  if (diff?.sql) {
    return [
      `-- Gerado pelo \`shieldepy chaos --init\` a partir de ${plan.prisma!.schema} (o projeto não tem migrations).`,
      '-- Mudou o schema.prisma? Gere de novo com:',
      `-- ${diff.command} > ${CHAOS_SCHEMA_FILE}`,
      '',
      diff.sql.trim(),
      '',
    ].join('\n');
  }
  if (diff) {
    return [
      `-- O projeto não tem migrations do Prisma, e o --init não conseguiu gerar o esquema de ${plan.prisma!.schema}.`,
      `-- Gere com (o chaos/db.ts aplica este arquivo): ${diff.command} > ${CHAOS_SCHEMA_FILE}`,
      '',
    ].join('\n');
  }
  return [
    '-- O projeto não tem .sql de esquema: escreva aqui os CREATE TABLE (o chaos/db.ts aplica este arquivo).',
    `-- Tabelas que o mapa viu o app usar: ${plan.tables.join(', ') || '(nenhuma com nome literal)'}.`,
    '',
  ].join('\n');
}

function prismaDb(plan: ChaosDbPlan, schema: string[]): string {
  const envVars = plan.prisma?.envVars.length ? plan.prisma.envVars : ['DATABASE_URL'];
  return [
    '// Gerado pelo `shieldepy chaos --init`: o banco dos testes de caos. Pode editar (o --init não sobrescreve).',
    '// PGlite: o Postgres de verdade em WebAssembly, no mesmo processo, servido pelo protocolo do Postgres',
    '// numa porta livre (pglite-socket). O Prisma do app não muda: só a URL do banco aponta para cá, antes',
    '// de o app carregar (o chaos/setup.ts importa este arquivo primeiro).',
    "import { readFileSync } from 'node:fs';",
    "import { createRequire } from 'node:module';",
    "import { PGlite } from '@electric-sql/pglite';",
    "import { PGLiteSocketServer } from '@electric-sql/pglite-socket';",
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
    '// Várias conexões ao mesmo PGlite: o servidor põe as consultas numa fila, e uma transação aberta só',
    '// deixa passar as da conexão dela. A rede devolve a vez ao event loop a cada consulta, e é isso que',
    '// deixa a corrida aparecer (o banco do `pg` precisa de uma pausa de propósito).',
    'const server = new PGLiteSocketServer({ db, port: 0, maxConnections: 20 });',
    'await ready;',
    'await server.start();',
    '',
    '// connection_limit=1: o motor do Prisma 4 a 6 abre conexões novas devagar, e a primeira requisição',
    '// terminava sozinha antes de as outras entrarem (o teste de corrida passava num código que corre).',
    '// Com uma conexão, as consultas entram na fila na ordem em que chegam. O Prisma 7 (com o',
    '// @prisma/adapter-pg) usa o pool do `pg`, que ignora o parâmetro: ali a conexão única vem do Pool abaixo.',
    'const url = `postgresql://postgres:postgres@${server.getServerConn()}/postgres?sslmode=disable&connection_limit=1`;',
    `for (const name of ${list(envVars)}) process.env[name] = url;`,
    '',
    '// Prisma 7: o adapter cria o pool com `new pg.Pool(...)`; trocado no módulo em cache, ele sai com uma',
    '// conexão só (sem isso, a segunda requisição esperava abrir uma conexão nova e a corrida sumia).',
    'try {',
    "  const pg = createRequire(import.meta.url)('pg') as { Pool: new (options?: object) => object };",
    '  const Pool = pg.Pool;',
    '  pg.Pool = class extends (Pool as new (options?: object) => object) {',
    '    constructor(options: object = {}) {',
    '      super({ ...options, max: 1 });',
    '    }',
    '  };',
    '} catch {',
    '  // sem o `pg` instalado: Prisma 4 a 6, com o motor próprio',
    '}',
    '',
    ...RESET_DB,
    '  // ex.: o registro de id 1 que as rotas com :id do contrato usam (os nomes são os do esquema, com aspas)',
    '  // await db.exec(`INSERT INTO "User" (email, name) VALUES (\'a@exemplo.com\', \'Ana\')`);',
    '}',
    '',
  ].join('\n');
}

function pgDb(schema: string[]): string {
  return [
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
    ...RESET_DB,
    '  // ex.: o registro de id 1 que as rotas com :id do contrato usam',
    "  // await db.exec(`INSERT INTO category (name) VALUES ('Livros')`);",
    '}',
    '',
  ].join('\n');
}
