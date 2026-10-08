import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { packageNodeId, type CodeGraph } from '../src/index';
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
});
