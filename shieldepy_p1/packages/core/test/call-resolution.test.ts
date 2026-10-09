import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageNodeId, type CallSite, type CodeGraph } from '../src/index';
import { createGraph, Fixture, indexFile, symbolId } from './helpers';

/** Id do método `name` da classe/objeto `container` no arquivo. */
function methodId(graph: CodeGraph, container: string, name: string, fileId: string): string {
  const id = graph.ownedSymbols(fileId).find((s) => {
    const a = graph.nodeAttributes(s);
    return a?.kind === 'method' && a.container === container && a.name === name;
  });
  if (!id) throw new Error(`método ${container}.${name} não encontrado`);
  return id;
}

describe('Fase 0 — resolução de chamadas por tipo do receptor', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('this.m() liga ao método da PRÓPRIA classe, não ao homônimo de outra', () => {
    const f = indexFile(
      graph,
      fx,
      'a.ts',
      'class A { run() { this.save(); } save() {} }\nclass B { save() {} }\n'
    );
    const run = methodId(graph, 'A', 'run', f);
    expect(graph.hasEdge(run, methodId(graph, 'A', 'save', f), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'B', 'save', f), 'calls')).toBe(false);
  });

  it('this.repo.save() com parameter property tipada e importada', () => {
    const repos = indexFile(graph, fx, 'repos.ts', 'export class OrderRepo { save() {} }\nexport class UserRepo { save() {} }\n');
    const svc = indexFile(
      graph,
      fx,
      'svc.ts',
      "import { OrderRepo } from './repos';\nexport class Svc {\n  constructor(private readonly repo: OrderRepo) {}\n  create() { this.repo.save(); }\n}\n"
    );
    const create = methodId(graph, 'Svc', 'create', svc);
    expect(graph.hasEdge(create, methodId(graph, 'OrderRepo', 'save', repos), 'calls')).toBe(true);
    expect(graph.hasEdge(create, methodId(graph, 'UserRepo', 'save', repos), 'calls')).toBe(false);
    expect(graph.fileCoverage(svc)).toMatchObject({ callsResolved: 1, callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('campos: `x = new X()`, `this.y = new Y()` no construtor e cadeia `this.deps.repo.save()`', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      [
        'class Repo { save() {} }',
        'class Mailer { send() {} }',
        'class Deps { repo: Repo; }',
        'class Svc {',
        '  mailer = new Mailer();',
        '  constructor(private deps: Deps) { this.audit = new Repo(); }',
        '  run() { this.mailer.send(); this.audit.save(); this.deps.repo.save(); }',
        '}',
      ].join('\n')
    );
    const run = methodId(graph, 'Svc', 'run', f);
    expect(graph.hasEdge(run, methodId(graph, 'Mailer', 'send', f), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'Repo', 'save', f), 'calls')).toBe(true);
    expect(graph.fileCoverage(f).callsHeuristic).toBe(0);
  });

  it('variável `new X()` e parâmetro tipado', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      'class Svc { run() {} }\nfunction a() { const s = new Svc(); s.run(); }\nfunction b(s: Svc) { s.run(); }\n'
    );
    const run = methodId(graph, 'Svc', 'run', f);
    expect(graph.hasEdge(symbolId(graph, 'a', f), run, 'calls')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'b', f), run, 'calls')).toBe(true);
  });

  it('instância exportada (`export const orderService = new OrderService()`) usada em outro arquivo', () => {
    const svc = indexFile(
      graph,
      fx,
      'svc.ts',
      'class OrderService { create() {} }\nclass Other { create() {} }\nexport const orderService = new OrderService();\n'
    );
    const route = indexFile(graph, fx, 'route.ts', "import { orderService } from './svc';\nexport function post() { orderService.create(); }\n");
    const post = symbolId(graph, 'post', route);
    expect(graph.hasEdge(post, methodId(graph, 'OrderService', 'create', svc), 'calls')).toBe(true);
    expect(graph.hasEdge(post, methodId(graph, 'Other', 'create', svc), 'calls')).toBe(false);
  });

  it('objeto literal exportado (`export const repo = { save() {}, find: async () => {} }`)', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export const repo = { save() {}, find: async () => {} };\n');
    const svc = indexFile(graph, fx, 'svc.ts', "import { repo } from './repo';\nexport function run() { repo.find(); repo.save(); }\n");
    const run = symbolId(graph, 'run', svc);
    expect(graph.hasEdge(run, methodId(graph, 'repo', 'find', repo), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'repo', 'save', repo), 'calls')).toBe(true);
  });

  it('herança entre arquivos e super.m()', () => {
    const base = indexFile(graph, fx, 'base.ts', 'export class BaseRepo { save() {} log() {} }\n');
    const f = indexFile(
      graph,
      fx,
      'order.ts',
      "import { BaseRepo } from './base';\nclass OrderRepo extends BaseRepo { log() { super.log(); } }\nfunction go() { const r = new OrderRepo(); r.save(); }\n"
    );
    expect(graph.hasEdge(symbolId(graph, 'go', f), methodId(graph, 'BaseRepo', 'save', base), 'calls')).toBe(true);
    expect(graph.hasEdge(methodId(graph, 'OrderRepo', 'log', f), methodId(graph, 'BaseRepo', 'log', base), 'calls')).toBe(true);
  });

  it('interface: `repo: IRepo` liga às classes que fazem `implements IRepo`', () => {
    indexFile(graph, fx, 'types.ts', 'export interface IRepo { save(): void }\n');
    const impl = indexFile(graph, fx, 'pg.ts', "import { IRepo } from './types';\nexport class PgRepo implements IRepo { save() {} }\n");
    const svc = indexFile(
      graph,
      fx,
      'svc.ts',
      "import { IRepo } from './types';\nexport class Svc { constructor(private repo: IRepo) {} run() { this.repo.save(); } }\n"
    );
    expect(graph.hasEdge(methodId(graph, 'Svc', 'run', svc), methodId(graph, 'PgRepo', 'save', impl), 'calls')).toBe(true);
  });

  it('interface: classe que implementa indexada DEPOIS do usuário (e removida depois) religa o usuário', () => {
    indexFile(graph, fx, 'types.ts', 'export interface Gateway { charge(): void }\n');
    const svc = indexFile(
      graph,
      fx,
      'svc.ts',
      "import type { Gateway } from './types';\nexport class Svc { constructor(private g: Gateway) {} pay() { this.g.charge(); } }\n"
    );
    const impl = indexFile(graph, fx, 'stripe.ts', "import type { Gateway } from './types';\nexport class Stripe implements Gateway { charge() {} }\n");
    const pay = methodId(graph, 'Svc', 'pay', svc);
    expect(graph.hasEdge(pay, methodId(graph, 'Stripe', 'charge', impl), 'calls')).toBe(true);

    // editar a classe (ids mudam) mantém a ligação; apagar a remove
    const edited = indexFile(graph, fx, 'stripe.ts', "\n\nimport type { Gateway } from './types';\nexport class Stripe implements Gateway { charge() {} }\n");
    expect(graph.hasEdge(pay, methodId(graph, 'Stripe', 'charge', edited), 'calls')).toBe(true);
    graph.removeFile(fx.path('stripe.ts'));
    expect(graph.getSymbolContext(pay)).toEqual([]);
  });

  it('tipos e bases de pacote viram chamada externa', () => {
    const f = indexFile(
      graph,
      fx,
      'repo.ts',
      [
        "import { Pool } from 'pg';",
        "import { Repository } from 'typeorm';",
        'export class OrderRepo extends Repository {',
        '  constructor(private pool: Pool) { super(); }',
        '  a() { this.pool.query("select 1"); }',
        '  b() { this.findOne(); }',
        '}',
      ].join('\n')
    );
    expect(graph.hasEdge(methodId(graph, 'OrderRepo', 'a', f), packageNodeId('pg'), 'calls')).toBe(true);
    expect(graph.hasEdge(methodId(graph, 'OrderRepo', 'b', f), packageNodeId('typeorm'), 'calls')).toBe(true);
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });

  it('tipos globais (Array, Error) não contam como falha do mapa', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      'class AppError extends Error { describe() { this.toString(); } }\nclass Cart { items: Item[] = []; add(i: Item) { this.items.push(i); } }\n'
    );
    expect(graph.fileCoverage(f).callsUnresolved).toBe(0);
  });

  it('receptor nativo/global não é adivinhado por nome (`results.push`, `console.log`, `this.map.get`)', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      [
        'function push() {}',
        'function log() {}',
        'function get() {}',
        'class C { private map = new Map<string, number>(); run() { this.map.get("a"); } }',
        'export function run() { const results: string[] = []; results.push("a"); console.log("x"); const s = ""; s.trim(); }',
      ].join('\n')
    );
    const run = symbolId(graph, 'run', f);
    expect(graph.hasEdge(run, symbolId(graph, 'push', f), 'calls')).toBe(false);
    expect(graph.hasEdge(run, symbolId(graph, 'log', f), 'calls')).toBe(false);
    expect(graph.hasEdge(methodId(graph, 'C', 'run', f), symbolId(graph, 'get', f), 'calls')).toBe(false);
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('receptor vindo de retorno: tipo anotado (com Promise), `new X().m()` e chamada encadeada', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export class Repo { save() {} }\nexport class Other { save() {} }\nexport function makeRepo(): Repo { return new Repo(); }\n');
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      [
        "import { makeRepo, Repo } from './repo';",
        'async function load(): Promise<Repo> { return makeRepo(); }',
        'export async function a() { const r = makeRepo(); r.save(); }',
        'export async function b() { const r = await load(); r.save(); }',
        'export function c() { makeRepo().save(); new Repo().save(); }',
      ].join('\n')
    );
    const save = methodId(graph, 'Repo', 'save', repo);
    const other = methodId(graph, 'Other', 'save', repo);
    for (const fn of ['a', 'b', 'c']) {
      expect(graph.hasEdge(symbolId(graph, fn, f), save, 'calls')).toBe(true);
      expect(graph.hasEdge(symbolId(graph, fn, f), other, 'calls')).toBe(false);
    }
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('valor devolvido por pacote é externo (`Router().post`, `res.status().json`)', () => {
    const f = indexFile(
      graph,
      fx,
      'routes.ts',
      [
        "import { Router, type Response } from 'express';",
        'function post() {}',
        'function json() {}',
        'const router = Router();',
        'export function register(res: Response) { router.post("/x"); res.status(400).json({}); }',
      ].join('\n')
    );
    const register = symbolId(graph, 'register', f);
    expect(graph.hasEdge(register, symbolId(graph, 'post', f), 'calls')).toBe(false);
    expect(graph.hasEdge(register, symbolId(graph, 'json', f), 'calls')).toBe(false);
    expect(graph.hasEdge(register, packageNodeId('express'), 'calls')).toBe(true);
    expect(graph.fileCoverage(f)).toMatchObject({ callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('parâmetro com o mesmo nome de um import esconde o import (sem aresta falsa)', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export function save() {}\n');
    const f = indexFile(graph, fx, 'f.ts', "import { save } from './repo';\nexport function run(save: () => void) { save(); }\n");
    expect(graph.hasEdge(symbolId(graph, 'run', f), symbolId(graph, 'save', repo), 'calls')).toBe(false);
  });

  it('Express: handlers passados como valor viram `references`; callback inline vira símbolo', () => {
    const auth = indexFile(graph, fx, 'auth.ts', 'export function auth() {}\n');
    const ctrl = indexFile(
      graph,
      fx,
      'ctrl.ts',
      'class CheckoutController { create() {} }\nexport const ctrl = new CheckoutController();\n'
    );
    const svc = indexFile(graph, fx, 'svc.ts', 'export async function checkout() {}\n');
    const app = indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        "import { auth } from './auth';",
        "import { ctrl } from './ctrl';",
        "import { checkout } from './svc';",
        'const app = express();',
        "app.post('/checkout', auth, ctrl.create, async (req, res) => { await checkout(req.body); res.json({}); });",
      ].join('\n')
    );

    const inline = symbolId(graph, "app.post('/checkout')", app);
    expect(graph.hasEdge(app, symbolId(graph, 'auth', auth), 'references')).toBe(true);
    expect(graph.hasEdge(app, methodId(graph, 'CheckoutController', 'create', ctrl), 'references')).toBe(true);
    expect(graph.hasEdge(app, inline, 'references')).toBe(true);
    expect(graph.hasEdge(inline, symbolId(graph, 'checkout', svc), 'calls')).toBe(true);
  });

  it('`references` não forma ciclo (passar callback não é laço de execução)', () => {
    const f = indexFile(graph, fx, 'f.ts', 'function run(cb: () => void) {}\nfunction a() { run(b); }\nfunction b() { a(); }\n');
    expect(graph.hasEdge(symbolId(graph, 'a', f), symbolId(graph, 'b', f), 'references')).toBe(true);
    expect(graph.cyclesInFile(f)).toEqual([]);
  });

  it('objeto literal exportado (default e aninhado) e propriedade que aponta para função importada', () => {
    const app = indexFile(graph, fx, 'app.ts', 'export function createApp() {}\n');
    const cfg = indexFile(
      graph,
      fx,
      'config.ts',
      [
        "import { createApp } from './app';",
        'function seed() {}',
        'export default {',
        '  createApp,',
        '  start: seed,',
        '  async reset() {},',
        "  invariants: { async stockNeverNegative() { return true; }, 'with-dash': async () => true },",
        '};',
      ].join('\n')
    );
    const t = indexFile(
      graph,
      fx,
      'smoke.ts',
      "import config from './config';\nexport async function run() {\n  config.createApp();\n  config.start();\n  await config.reset();\n  await config.invariants.stockNeverNegative();\n}\n"
    );
    const run = symbolId(graph, 'run', t);
    expect(graph.hasEdge(run, symbolId(graph, 'createApp', app), 'calls')).toBe(true);
    expect(graph.hasEdge(run, symbolId(graph, 'seed', cfg), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'default', 'reset', cfg), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'default.invariants', 'stockNeverNegative', cfg), 'calls')).toBe(true);
    expect(methodId(graph, 'default.invariants', 'with-dash', cfg)).toBeDefined();
    expect(graph.fileCoverage(t)).toMatchObject({ callsResolved: 4, callsHeuristic: 0, callsUnresolved: 0 });
  });

  it('`export default new Svc()`: a instância exportada leva ao método da classe', () => {
    const svc = indexFile(graph, fx, 'svc.ts', 'class Svc { save() {} }\nclass Other { save() {} }\nexport default new Svc();\n');
    const t = indexFile(graph, fx, 'use.ts', "import svc from './svc';\nexport function run() { svc.save(); }\n");
    const run = symbolId(graph, 'run', t);
    expect(graph.hasEdge(run, methodId(graph, 'Svc', 'save', svc), 'calls')).toBe(true);
    expect(graph.hasEdge(run, methodId(graph, 'Other', 'save', svc), 'calls')).toBe(false);
    expect(graph.fileCoverage(t).callsHeuristic).toBe(0);
  });
});

describe('E2 — cada chamada em ordem, com posição e argumentos (callSitesIn / callsOf)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const label = (c: CallSite) => [...(c.object ?? []), c.name].join('.');

  it('ordem de execução aproximada: a chamada de dentro (que termina antes) vem primeiro', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      [
        'function a(x: number) { return x; }',
        'function b() { return 1; }',
        'class R { s(n: number) { return this; } j(v: unknown) {} }',
        'async function run(r: R) {',
        '  a(b());',
        '  r.s(201).j(a(2));',
        '}',
      ].join('\n')
    );
    const run = symbolId(graph, 'run', f);
    const calls = graph.callsOf(run);
    expect(calls.map(label)).toEqual(['b', 'a', 'r.s', 'a', 'j']);
    expect(calls[0]).toMatchObject({ caller: run, line: 4, column: 4, outcome: 'resolved' });
  });

  it('argumentos estáticos: string, template (prefixo), objeto (chaves), callback e nome', () => {
    const f = indexFile(
      graph,
      fx,
      'f.ts',
      [
        'function handler() {}',
        'function go(id: string, opts: object) {',
        "  call('it\\'s', `https://api.ação.com/v1/${id}/x`, `sem-subst`, { method: 'POST', signal, 'x-y': 1, ...opts }, () => 1, handler, 42);",
        '}',
      ].join('\n')
    );
    const [site] = graph.callsOf(symbolId(graph, 'go', f));
    expect(site!.args.slice(0, 4)).toEqual([
      { kind: 'string', value: "it's" },
      { kind: 'template', prefix: 'https://api.ação.com/v1/' },
      { kind: 'string', value: 'sem-subst' },
      // `texts`: só as chaves com texto literal (o SQL de `pool.query({ text: '...' })`)
      { kind: 'object', keys: ['method', 'signal', 'x-y', '...'], texts: { method: { kind: 'string', value: 'POST' } } },
    ]);
    expect(site!.args[4]).toEqual({ kind: 'function' }); // callback dentro de função não vira símbolo
    expect(site!.args[5]).toMatchObject({ kind: 'name', chain: ['handler'], outcome: 'resolved', targets: [symbolId(graph, 'handler', f)] });
    expect(site!.args[6]).toEqual({ kind: 'other' });
  });

  it('chamadas no topo do arquivo entram em callSitesIn (chamador = arquivo), mas não viram aresta nem cobertura', () => {
    const f = indexFile(
      graph,
      fx,
      'routes.ts',
      [
        "import { Router } from 'express';",
        'function create() {}',
        'export const router = Router();',
        "router.post('/x', create, async (req, res) => { create(); });",
      ].join('\n')
    );
    const sites = graph.callSitesIn(f);
    const post = sites.find((c) => c.name === 'post')!;
    expect(post).toMatchObject({ caller: f, line: 3, outcome: 'external', package: 'express', receiverOrigin: { file: f, name: 'router' } });
    expect(post.args[0]).toEqual({ kind: 'string', value: '/x' });
    expect(post.args[2]).toMatchObject({ kind: 'function', symbolId: expect.stringContaining("router.post('/x')") });
    // callback inline: a chamada de dentro é do callback, não do arquivo
    expect(sites.find((c) => c.name === 'create')!.caller).toBe((post.args[2] as { symbolId: string }).symbolId);
    // as do topo não contam (Router() e router.post): só o create() do callback
    expect(graph.fileCoverage(f)).toMatchObject({ callsResolved: 1, callsExternal: 0 });
    expect(graph.hasEdge(f, packageNodeId('express'), 'calls')).toBe(false);
  });

  it('pacote da chamada externa e `fetch` global × local', () => {
    indexFile(graph, fx, 'repo.ts', "import type { Pool } from 'pg';\nexport class Repo {\n  constructor(private db: Pool) {}\n  get() { return this.db.query('SELECT 1'); }\n}\n");
    const f = indexFile(
      graph,
      fx,
      'api.ts',
      "async function a() { await fetch('https://x.com'); }\nasync function b(fetch: (u: string) => void) { fetch('https://y.com'); }\n"
    );
    const [global] = graph.callsOf(symbolId(graph, 'a', f));
    const [local] = graph.callsOf(symbolId(graph, 'b', f));
    expect(global).toMatchObject({ name: 'fetch', outcome: 'unbound' });
    expect(global!.shadowed).toBeUndefined();
    expect(local).toMatchObject({ name: 'fetch', outcome: 'unbound', shadowed: true });

    const repo = graph.files().find((id) => id.endsWith('repo.ts'))!;
    const [query] = graph.callSitesIn(repo);
    expect(query).toMatchObject({ object: ['this', 'db'], name: 'query', outcome: 'external', package: 'pg', targets: [] });
  });

  it('origem de um valor atravessa import e barrel: `app.use("/api", router)` acha onde `router` é declarado', () => {
    const routes = indexFile(graph, fx, 'routes/orders.ts', "import { Router } from 'express';\nexport const ordersRouter = Router();\n");
    indexFile(graph, fx, 'routes/index.ts', "export * from './orders';\n");
    const app = indexFile(
      graph,
      fx,
      'app.ts',
      "import express from 'express';\nimport { ordersRouter as r } from './routes';\nexport function createApp() {\n  const app = express();\n  app.use('/api', r);\n  return app;\n}\n"
    );
    const use = graph.callsOf(symbolId(graph, 'createApp', app)).find((c) => c.name === 'use')!;
    expect(use).toMatchObject({ package: 'express', receiverOrigin: { file: app, name: 'app', local: true } });
    expect(use.args[1]).toMatchObject({ kind: 'name', chain: ['r'], origin: { file: routes, name: 'ordersRouter' } });
  });

  it('a posição acompanha a edição do arquivo', () => {
    const fsPath = fx.write('f.ts', 'function f() { g(); }\nfunction g() {}\n');
    graph.updateFile(fsPath, 'function f() { g(); }\nfunction g() {}\n');
    graph.updateFile(fsPath, 'function f() {\n\n  g();\n}\nfunction g() {}\n');
    const f = graph.files()[0]!;
    expect(graph.callsOf(symbolId(graph, 'f', f))).toMatchObject([{ name: 'g', line: 2, column: 2, outcome: 'resolved' }]);
  });
});
