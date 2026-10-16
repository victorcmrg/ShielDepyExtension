// Templates determinísticos: spec validada → arquivo `.spec.ts` (Vitest + supertest + MSW). A IA
// nunca escreve o corpo do teste; aqui só entram dados validados, sempre via JSON.stringify.
// Todo arquivo tem o bloco de CONTROLE (a mesma requisição, sem caos): se ele falhar, o problema é
// do ambiente ou do teste, e a E4 marca o resultado como inválido em vez de bloquear o PR.

import type { AttackSurface, ChaosConfigFacts } from '@shieldepy/core';
import type { Hypothesis } from './hypotheses';
import type { ChaosSpec, DbSpec, Invariant, NetworkSpec } from './specs';

export const CHAOS_TESTS_DIR = '.shieldepy/chaos-tests';

/** Nome do bloco de controle — a E4 separa "controle falhou" (inválido) de "caos falhou" (achado). */
export const CONTROL_TEST_NAME = 'controle: a mesma requisição, sem caos, funciona';

/**
 * Começo da mensagem do teste de banco quando a gravação alvo não aconteceu depois da API (ex.: ela
 * só existe no caminho de erro). A E4 classifica como inválido: não houve falha injetada, não é achado.
 */
export const DB_NOT_FIRED = 'a falha não disparou';

/** Latência normal das APIs externas no teste: sem ela, requisições simultâneas nem se sobrepõem. */
const API_LATENCY_MS = 50;
/** Paciência do controle e dos testes que não medem tempo. */
const DEFAULT_PATIENCE_MS = 10_000;

export interface GeneratedFile {
  /** Relativo à raiz do projeto, com `/`. */
  path: string;
  content: string;
}

export interface RenderContext {
  surface: AttackSurface;
  config: ChaosConfigFacts;
  hypotheses: Hypothesis[];
  /** Config do Vite/Vitest do projeto (`vitest.config.ts`), para herdar aliases e plugins. */
  projectViteConfig?: string;
  /** `tsconfig.json` do projeto: os testes gerados são checados com ele (paths, strict). */
  projectTsconfig?: string;
}

/** `POST /checkout__race_condition__stock` → `POST__checkout__race_condition__stock`. */
export function specFileName(hypothesisId: string): string {
  let out = '';
  for (const c of hypothesisId) out += (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '.' || c === '-' || c === '_' ? c : '_';
  return `${out}.spec.ts`;
}

const js = (value: unknown) => JSON.stringify(value);

/** Hosts das APIs que a rota chama (todos recebem a resposta saudável). */
function routeHosts(surface: AttackSurface, routeId: string): string[] {
  const route = surface.routes.find((r) => r.id === routeId);
  return [...new Set((route?.operations ?? []).filter((o) => o.kind === 'api_call' && o.target !== 'dynamic').map((o) => o.target))].sort();
}

function supertestMethod(routeId: string): string {
  const method = routeId.slice(0, routeId.indexOf(' ')).toLowerCase();
  return method === 'all' ? 'get' : method;
}

/** A resposta da falha, no handler do MSW. */
function faultHandler(fault: NetworkSpec['fault'], host: string): string {
  switch (fault.mode) {
    case 'delay':
      return `async () => {\n      await delay(${fault.delayMs});\n      return HttpResponse.json(healthyBody(${js(host)}));\n    }`;
    case 'status':
      return `() => HttpResponse.json({ error: { message: 'falha injetada pelo ShielDepy' } }, { status: ${fault.status} })`;
    case 'malformed':
      switch (fault.body) {
        case 'html':
          return `() => new HttpResponse('<html><body>502 Bad Gateway</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })`;
        case 'truncated_json':
          return `() => new HttpResponse('{"id": "ch_', { status: 200, headers: { 'content-type': 'application/json' } })`;
        case 'empty':
          return `() => new HttpResponse(null, { status: 200 })`;
        case 'wrong_shape':
          return `() => HttpResponse.json({ unexpected: true })`;
      }
  }
}

/** O erro que o banco "devolve" em cada tipo de falha (o formato do `pg`: mensagem do Postgres e `code`). */
const DB_ERROR_CODE: Record<DbSpec['error'], string> = {
  connection: "Object.assign(new Error('Connection terminated unexpectedly (falha injetada pelo ShielDepy)'), { code: 'ECONNRESET' })",
  constraint: "Object.assign(new Error('duplicate key value violates unique constraint (falha injetada pelo ShielDepy)'), { code: '23505', table: TARGET })",
  timeout: "Object.assign(new Error('canceling statement due to statement timeout (falha injetada pelo ShielDepy)'), { code: '57014' })",
};

/**
 * A espiã do DB_Chaos: troca o `query` do `Pool` e do `Client` do `pg` (como o app o enxerga: com o
 * `vi.mock('pg')` do projeto, são as classes do banco de teste). Tudo passa até uma API da rota
 * responder com sucesso; depois, a primeira gravação na tabela alvo falha. O SQL é casado por
 * palavras, em tempo de execução (é o texto que o app manda ao banco, não código lido).
 */
function dbFaultCode(spec: DbSpec): string[] {
  return [
    `const TARGET = ${js(spec.target.toLowerCase())};`,
    `const OP = ${js(spec.op)};`,
    '',
    '/** Palavras do SQL, em minúsculas, sem aspas e sem o schema (`"public"."Orders"` → `orders`). */',
    'function sqlWords(sql: string): string[] {',
    '  const words: string[] = [];',
    "  let word = '';",
    '  for (const c of sql.toLowerCase()) {',
    "    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '_' || c === '$') word += c;",
    "    else if (c === '.') {",
    '      // o que veio antes do ponto é o schema: some (sem aspas, ainda está em `word`; com aspas, já entrou)',
    "      if (word) word = '';",
    '      else words.pop();',
    '    } else if (word) {',
    '      words.push(word);',
    "      word = '';",
    '    }',
    '  }',
    '  if (word) words.push(word);',
    '  return words;',
    '}',
    '',
    '/** A gravação que o SQL faz (`INSERT INTO t`, `UPDATE t`, `DELETE FROM t`), pelo primeiro verbo. */',
    'function writeOf(sql: string): { op: string; table: string } | undefined {',
    '  const w = sqlWords(sql);',
    '  for (let i = 0; i < w.length; i++) {',
    "    if (w[i] === 'insert' && w[i + 1] === 'into') return { op: 'insert', table: w[i + 2] ?? '' };",
    "    if (w[i] === 'update' && w[i - 1] !== 'for' && w[i - 1] !== 'do') return { op: 'update', table: (w[i + 1] === 'only' ? w[i + 2] : w[i + 1]) ?? '' };",
    "    if (w[i] === 'delete' && w[i + 1] === 'from') return { op: 'delete', table: (w[i + 2] === 'only' ? w[i + 3] : w[i + 2]) ?? '' };",
    '  }',
    '  return undefined;',
    '}',
    '',
    '/** As classes do `pg` que o app usa (um mock pode não ter todas: ler um export ausente lança). */',
    'function pgPrototypes(): { query: (...args: unknown[]) => unknown }[] {',
    '  const mod = pg as unknown as Record<string, any>;',
    '  const read = (from: any, key: string) => {',
    '    try {',
    '      return from?.[key];',
    '    } catch {',
    '      return undefined;',
    '    }',
    '  };',
    "  const classes = ['Pool', 'Client'].flatMap((k) => [read(mod, k), read(read(mod, 'default'), k)]);",
    "  return [...new Set(classes.filter((c) => typeof c?.prototype?.query === 'function').map((c) => c.prototype))];",
    '}',
    '',
    '/** Liga a falha: a primeira gravação em TARGET depois de uma API da rota responder falha. */',
    'function breakFirstWrite(): { injected: boolean; restore(): void } {',
    '  const state = { injected: false, restore: () => {} };',
    '  const protos = pgPrototypes();',
    `  expect(protos.length, ${js(`${DB_NOT_FIRED}: o app não usa o pg (Pool/Client), então não há onde injetar a falha`)}).toBeGreaterThan(0);`,
    '  const originals = protos.map((p) => p.query);',
    '  protos.forEach((proto, i) => {',
    '    proto.query = function (this: unknown, ...args: unknown[]) {',
    '      const first = args[0] as string | { text?: string } | undefined;',
    "      const sql = typeof first === 'string' ? first : (first?.text ?? '');",
    '      const write = !state.injected && apiCalls.length > 0 ? writeOf(sql) : undefined;',
    "      if (write && write.table === TARGET && (OP === 'any' || write.op === OP)) {",
    '        state.injected = true;',
    `        return Promise.reject(${DB_ERROR_CODE[spec.error]});`,
    '      }',
    '      return originals[i]!.apply(this, args);',
    '    };',
    '  });',
    '  state.restore = () => protos.forEach((proto, i) => (proto.query = originals[i]!));',
    '  return state;',
    '}',
    '',
  ];
}

/** Uma asserção por invariante, com a mensagem que aparece no relatório. */
function assertion(inv: Invariant): string {
  switch (inv.kind) {
    case 'respondsWithin':
      return `  for (const o of outcomes) expect(o.timedOut, 'respondsWithin: o cliente ficou mais de ${inv.ms} ms sem resposta').toBe(false);`;
    case 'statusIn':
      return `  for (const o of outcomes) expect(${js(inv.statuses)}, o.timedOut ? \`statusIn: a rota não respondeu em \${o.ms} ms\` : \`statusIn: a rota respondeu \${o.status}\`).toContain(o.status);`;
    case 'noUnhandledError':
      return `  expect(outcomes.filter((o) => o.status === 500).length, 'noUnhandledError: a falha virou 500 (exceção não tratada)').toBe(0);`;
    case 'maxSuccesses':
      return `  expect(outcomes.filter((o) => o.status !== undefined && o.status < 300).length, 'maxSuccesses: mais de ${inv.count} requisição(ões) com sucesso').toBeLessThanOrEqual(${inv.count});`;
    case 'stateCheck':
      return `  await stateCheck(${js(inv.name)});`;
  }
}

function renderSpecFile(spec: ChaosSpec, h: Hypothesis | undefined, ctx: RenderContext): string {
  const hosts = routeHosts(ctx.surface, spec.routeId);
  const patience = spec.expect.find((e): e is Extract<Invariant, { kind: 'respondsWithin' }> => e.kind === 'respondsWithin')?.ms ?? DEFAULT_PATIENCE_MS;
  const stateChecks = spec.expect.filter((e) => e.kind === 'stateCheck');
  const chaosBody =
    spec.kind === 'network'
      ? [
          `  it(${js(`caos: ${h?.failure ?? spec.hypothesisId} em ${spec.host}`)}, async () => {`,
          `    server.use(...[\`https://\${HOST}/*\`, \`http://\${HOST}/*\`].map((url) => http.all(url, ${faultHandler(spec.fault, spec.host)})));`,
          `    const outcomes = [await send(${patience})];`,
          `    await verify(outcomes);`,
          `  });`,
        ]
      : spec.kind === 'concurrency'
        ? [
            `  it(${js(`caos: ${spec.parallel} requisições simultâneas`)}, async () => {`,
            `    const outcomes = await Promise.all(Array.from({ length: ${spec.parallel} }, () => send(${patience})));`,
            `    await verify(outcomes);`,
            `  });`,
          ]
        : [
            `  it(${js(`caos: ${spec.op === 'any' ? 'gravação' : spec.op} em ${spec.target} falha (${spec.error}) depois da API`)}, async () => {`,
            '    const fault = breakFirstWrite();',
            '    let outcomes: Outcome[];',
            '    try {',
            `      outcomes = [await send(${patience})];`,
            '    } finally {',
            '      fault.restore();',
            '    }',
            `    expect(fault.injected, ${js(`${DB_NOT_FIRED}: nenhuma gravação em ${spec.target}${spec.op === 'any' ? '' : ` (${spec.op})`} depois da chamada à API nesta requisição`)}).toBe(true);`,
            '    await verify(outcomes);',
            '  });',
          ];

  return [
    '// Gerado pelo ShielDepy — não editar: é regerado a cada execução.',
    `// Hipótese: ${spec.hypothesisId} (${h?.source ?? 'motor'}; spec: ${spec.source})`,
    ...(h ? [`// Por quê: ${h.rationale.split('\n').join(' ')}`] : []),
    `// Topologia: ${ctx.surface.topologyHash}`,
    "import { delay, http, HttpResponse } from 'msw';",
    "import { setupServer } from 'msw/node';",
    "import request from 'supertest';",
    "import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';",
    ...(spec.kind === 'db' ? ["import * as pg from 'pg';"] : []),
    "import config from '../../shieldepy.chaos.config';",
    '',
    'type ChaosRequest = { path: string; body?: unknown; headers?: Record<string, string> };',
    '/** Uma chamada a uma API externa que deu certo (resposta saudável) durante o teste. */',
    'type ApiCall = { host: string; method: string; path: string };',
    '/** O que os invariantes recebem: o que aconteceu fora do banco (ex.: as cobranças feitas). */',
    'type ChaosInvariantContext = { apiCalls: ApiCall[] };',
    '/** O contrato visto de forma solta: o arquivo compila com qualquer config que o siga. */',
    'const project = config as unknown as {',
    '  createApp(): Parameters<typeof request>[0];',
    '  reset?(): Promise<void> | void;',
    '  invariants?: Record<string, (ctx: ChaosInvariantContext) => Promise<boolean> | boolean>;',
    '  requests?: Record<string, ChaosRequest>;',
    '  apis?: Record<string, () => unknown>;',
    '};',
    '',
    `const SPEC = ${js(spec)} as const;`,
    `const ROUTE = ${js(spec.routeId)};`,
    ...(spec.kind === 'network' ? [`const HOST = ${js(spec.host)};`] : []),
    `const API_HOSTS: string[] = ${js(hosts)};`,
    "const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);",
    '',
    '/** As chamadas às APIs que deram certo neste teste (zerado antes de cada um): o contexto dos invariantes. */',
    'const apiCalls: ApiCall[] = [];',
    'const healthyBody = (host: string) => (project.apis?.[host]?.() ?? {}) as Record<string, unknown>;',
    'const healthy = (host: string) =>',
    '  [`https://${host}/*`, `http://${host}/*`].map((url) =>',
    '    http.all(url, async ({ request: req }) => {',
    `      await delay(${API_LATENCY_MS});`,
    '      apiCalls.push({ host, method: req.method, path: new URL(req.url).pathname });',
    '      return HttpResponse.json(healthyBody(host));',
    '    })',
    '  );',
    'const server = setupServer(...API_HOSTS.flatMap(healthy));',
    '',
    '// o supertest fala com o app em 127.0.0.1; qualquer outro host não mockado é erro',
    'beforeAll(() =>',
    '  server.listen({',
    '    onUnhandledRequest: (req, print) => {',
    '      if (!LOCAL_HOSTS.has(new URL(req.url).hostname)) print.error();',
    '    },',
    '  })',
    ');',
    'afterEach(() => server.resetHandlers());',
    'afterAll(() => server.close());',
    'beforeEach(async () => {',
    '  apiCalls.length = 0;',
    '  await project.reset?.();',
    '});',
    '',
    'const app = project.createApp();',
    '',
    'interface Outcome {',
    '  status?: number;',
    '  ms: number;',
    '  timedOut: boolean;',
    '}',
    '',
    'async function send(timeoutMs: number): Promise<Outcome> {',
    '  const req = project.requests?.[ROUTE];',
    "  if (!req) throw new Error(`shieldepy.chaos.config.ts: falta requests['${ROUTE}'] (uma requisição válida desta rota)`);",
    '  const started = Date.now();',
    `  let call = request(app).${supertestMethod(spec.routeId)}(req.path).timeout(timeoutMs);`,
    '  if (req.headers) call = call.set(req.headers);',
    '  try {',
    '    const res = await (req.body === undefined ? call : call.send(req.body as object));',
    '    return { status: res.status, ms: Date.now() - started, timedOut: false };',
    '  } catch (err) {',
    '    if ((err as { timeout?: number }).timeout) return { ms: Date.now() - started, timedOut: true };',
    '    throw err;',
    '  }',
    '}',
    '',
    'async function stateCheck(name: string): Promise<void> {',
    '  const check = project.invariants?.[name];',
    "  expect(check, `stateCheck: o invariante ${name} não está em invariants`).toBeTypeOf('function');",
    '  expect(await check!({ apiCalls: [...apiCalls] }), `stateCheck: ${name}`).toBe(true);',
    '}',
    '',
    'async function verify(outcomes: Outcome[]): Promise<void> {',
    ...spec.expect.map(assertion),
    '}',
    '',
    ...(spec.kind === 'db' ? dbFaultCode(spec) : []),
    'describe(SPEC.hypothesisId, () => {',
    `  it(${js(CONTROL_TEST_NAME)}, async () => {`,
    `    const o = await send(${DEFAULT_PATIENCE_MS});`,
    "    expect(o.timedOut, 'controle: a rota não respondeu sem caos').toBe(false);",
    "    expect(o.status, 'controle: a requisição do config não funciona sem caos').toBeLessThan(400);",
    ...stateChecks.map((s) => `  ${assertion(s)}`),
    '  });',
    '',
    ...chaosBody,
    '});',
    '',
  ].join('\n');
}

function renderViteConfig(ctx: RenderContext, testTimeoutMs: number): string {
  const project = ctx.projectViteConfig;
  return [
    '// Gerado pelo ShielDepy — não editar. Herda a config do projeto (aliases, plugins) e roda só os testes de caos.',
    "import { fileURLToPath } from 'node:url';",
    "import { defineConfig } from 'vitest/config';",
    ...(project ? [`import project from ${js(`../../${project.split('.').slice(0, -1).join('.')}`)};`] : []),
    '',
    "const root = fileURLToPath(new URL('../..', import.meta.url));",
    project
      ? "const base: any = (typeof project === 'function' ? await (project as any)({ command: 'serve', mode: 'test' }) : await project) ?? {};"
      : 'const base: any = {};',
    '',
    'export default defineConfig({',
    '  ...base,',
    '  root,',
    '  test: {',
    '    ...(base.test ?? {}),',
    `    include: [${js(`${CHAOS_TESTS_DIR}/**/*.spec.ts`)}],`,
    `    setupFiles: ${js(ctx.config.setupFiles)},`,
    `    testTimeout: ${testTimeoutMs},`,
    '    hookTimeout: 30000,',
    '  },',
    '});',
    '',
  ].join('\n');
}

/** Os arquivos a gravar e os avisos (contrato incompleto: o teste rodaria, mas cairia como inválido). */
export function renderChaosTests(specs: ChaosSpec[], ctx: RenderContext): { files: GeneratedFile[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!ctx.config.createApp) warnings.push('shieldepy.chaos.config.ts sem createApp(): nenhum teste consegue subir o app');
  if (!ctx.config.reset) warnings.push('shieldepy.chaos.config.ts sem reset(): um teste pode contaminar o próximo');
  const byId = new Map(ctx.hypotheses.map((h) => [h.id, h]));
  const files: GeneratedFile[] = [];
  let maxPatience = DEFAULT_PATIENCE_MS;
  for (const spec of specs) {
    if (!ctx.config.requests.includes(spec.routeId)) warnings.push(`${spec.hypothesisId}: falta requests['${spec.routeId}'] no config (o controle vai falhar)`);
    for (const host of routeHosts(ctx.surface, spec.routeId)) {
      if (!ctx.config.apis.includes(host)) warnings.push(`${spec.hypothesisId}: falta apis['${host}'] no config (sem resposta saudável, o controle vai falhar)`);
    }
    for (const inv of spec.expect) maxPatience = Math.max(maxPatience, inv.kind === 'respondsWithin' ? inv.ms : 0);
    files.push({ path: `${CHAOS_TESTS_DIR}/${specFileName(spec.hypothesisId)}`, content: renderSpecFile(spec, byId.get(spec.hypothesisId), ctx) });
  }
  if (files.length > 0) {
    files.push({ path: `${CHAOS_TESTS_DIR}/vitest.config.ts`, content: renderViteConfig(ctx, maxPatience * 2 + 10_000) });
    // `tsc -p .shieldepy/chaos-tests` checa os testes gerados com os paths e o strict do projeto
    if (ctx.projectTsconfig) {
      const tsconfig = { extends: `../../${ctx.projectTsconfig}`, compilerOptions: { noEmit: true }, include: ['./*.spec.ts'] };
      files.push({ path: `${CHAOS_TESTS_DIR}/tsconfig.json`, content: `${JSON.stringify(tsconfig, null, 2)}\n` });
    }
  }
  return { files, warnings: [...new Set(warnings)] };
}
