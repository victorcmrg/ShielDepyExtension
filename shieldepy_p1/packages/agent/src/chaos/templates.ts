// Templates determinísticos: spec validada → arquivo `.spec.ts` (Vitest + supertest + MSW). A IA
// nunca escreve o corpo do teste; aqui só entram dados validados, sempre via JSON.stringify.
// Todo arquivo tem o bloco de CONTROLE (a mesma requisição, sem caos): se ele falhar, o problema é
// do ambiente ou do teste, e a E4 marca o resultado como inválido em vez de bloquear o PR.

import type { AttackSurface, ChaosConfigFacts } from '@shieldepy/core';
import type { Hypothesis } from './hypotheses';
import type { ChaosSpec, Invariant, NetworkSpec } from './specs';

export const CHAOS_TESTS_DIR = '.shieldepy/chaos-tests';

/** Nome do bloco de controle — a E4 separa "controle falhou" (inválido) de "caos falhou" (achado). */
export const CONTROL_TEST_NAME = 'controle: a mesma requisição, sem caos, funciona';

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
      : [
          `  it(${js(`caos: ${spec.parallel} requisições simultâneas`)}, async () => {`,
          `    const outcomes = await Promise.all(Array.from({ length: ${spec.parallel} }, () => send(${patience})));`,
          `    await verify(outcomes);`,
          `  });`,
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
    "import config from '../../shieldepy.chaos.config';",
    '',
    'type ChaosRequest = { path: string; body?: unknown; headers?: Record<string, string> };',
    '/** O contrato visto de forma solta: o arquivo compila com qualquer config que o siga. */',
    'const project = config as unknown as {',
    '  createApp(): Parameters<typeof request>[0];',
    '  reset?(): Promise<void> | void;',
    '  invariants?: Record<string, () => Promise<boolean> | boolean>;',
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
    'const healthyBody = (host: string) => (project.apis?.[host]?.() ?? {}) as Record<string, unknown>;',
    'const healthy = (host: string) =>',
    '  [`https://${host}/*`, `http://${host}/*`].map((url) =>',
    '    http.all(url, async () => {',
    `      await delay(${API_LATENCY_MS});`,
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
    '  expect(await check!(), `stateCheck: ${name}`).toBe(true);',
    '}',
    '',
    'async function verify(outcomes: Outcome[]): Promise<void> {',
    ...spec.expect.map(assertion),
    '}',
    '',
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
