import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModuleResolver, packageName, packageNodeId, parseJsonc, type CodeGraph } from '../src/index';
import { createGraph, Fixture, indexFile, symbolId } from './helpers';

describe('Fase 0 — resolução por tabela de módulo (imports/exports)', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const calls = (from: string, fromFile: string, to: string, toFile: string) =>
    graph.hasEdge(symbolId(graph, from, fromFile), symbolId(graph, to, toFile), 'calls');

  it('import com alias: `import { save as persist }` liga persist() → save', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export function save() {}\n');
    const svc = indexFile(graph, fx, 'svc.ts', "import { save as persist } from './repo';\nexport function run() { persist(); }\n");

    expect(calls('run', svc, 'save', repo)).toBe(true);
    expect(graph.stats.callsResolved).toBeGreaterThan(0);
  });

  it('export default nomeado e anônimo', () => {
    const a = indexFile(graph, fx, 'a.ts', 'export default function handler() {}\n');
    const b = indexFile(graph, fx, 'b.ts', 'export default () => {};\n');
    const main = indexFile(graph, fx, 'main.ts', "import h from './a';\nimport anon from './b';\nexport function go() { h(); anon(); }\n");

    expect(calls('go', main, 'handler', a)).toBe(true);
    expect(calls('go', main, 'default', b)).toBe(true);
  });

  it('namespace: `import * as repo` liga repo.save() → save', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export function save() {}\nexport function load() {}\n');
    const svc = indexFile(graph, fx, 'svc.ts', "import * as repo from './repo';\nexport function run() { repo.save(); }\n");

    expect(calls('run', svc, 'save', repo)).toBe(true);
    expect(calls('run', svc, 'load', repo)).toBe(false);
  });

  it('barrel: `export * from` e `export { x as y } from` seguem até o arquivo real', () => {
    const impl = indexFile(graph, fx, 'services/orders.ts', 'export function createOrder() {}\nexport function cancel() {}\n');
    indexFile(graph, fx, 'services/index.ts', "export * from './orders';\nexport { cancel as cancelOrder } from './orders';\n");
    const route = indexFile(graph, fx, 'route.ts', "import { createOrder, cancelOrder } from './services';\nexport function post() { createOrder(); cancelOrder(); }\n");

    expect(calls('post', route, 'createOrder', impl)).toBe(true);
    expect(calls('post', route, 'cancel', impl)).toBe(true);
  });

  it('barrel: editar o arquivo real (ids mudam) religa quem importa o barrel', () => {
    indexFile(graph, fx, 'services/orders.ts', 'export function createOrder() {}\n');
    indexFile(graph, fx, 'services/index.ts', "export * from './orders';\n");
    const route = indexFile(graph, fx, 'route.ts', "import { createOrder } from './services';\nexport function post() { createOrder(); }\n");
    const impl = indexFile(graph, fx, 'services/orders.ts', '\n\n\nexport function createOrder() {}\n');

    expect(calls('post', route, 'createOrder', impl)).toBe(true);
  });

  it('CommonJS: require com desestruturação, namespace e module.exports', () => {
    const lib = indexFile(
      graph,
      fx,
      'lib.js',
      'function charge() {}\nfunction refund() {}\nmodule.exports = { charge, devolver: refund };\n'
    );
    const app = indexFile(
      graph,
      fx,
      'app.js',
      "const { charge } = require('./lib');\nconst lib = require('./lib');\nfunction pay() { charge(); lib.devolver(); }\n"
    );

    expect(calls('pay', app, 'charge', lib)).toBe(true);
    expect(calls('pay', app, 'refund', lib)).toBe(true);
  });

  it('CommonJS: `exports.f = function () {}` vira símbolo exportado', () => {
    const lib = indexFile(graph, fx, 'lib.js', 'exports.notify = function () {};\n');
    const app = indexFile(graph, fx, 'app.js', "const { notify } = require('./lib');\nfunction go() { notify(); }\n");

    expect(calls('go', app, 'notify', lib)).toBe(true);
  });

  it('tsconfig `paths` + `baseUrl` (com comentários e extends)', () => {
    fx.write('tsconfig.base.json', '{\n  // base\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], },\n  },\n}\n');
    fx.write('tsconfig.json', '{ "extends": "./tsconfig.base.json" }\n');
    const repo = indexFile(graph, fx, 'src/db/repo.ts', 'export function save() {}\n');
    const util = indexFile(graph, fx, 'src/util.ts', 'export function fmt() {}\n');
    const svc = indexFile(graph, fx, 'src/svc.ts', "import { save } from '@/db/repo';\nimport { fmt } from 'src/util';\nexport function run() { save(); fmt(); }\n");

    expect(graph.hasEdge(svc, repo, 'imports')).toBe(true);
    expect(calls('run', svc, 'save', repo)).toBe(true);
    expect(calls('run', svc, 'fmt', util)).toBe(true);
    expect(graph.stats.importsUnresolved).toBe(0);
  });

  it('pacotes externos viram nós `package`; chamadas a eles contam como externas', () => {
    const svc = indexFile(
      graph,
      fx,
      'svc.ts',
      "import axios from 'axios';\nimport { Pool } from 'pg';\nexport function run() { axios.post('https://x'); new Pool(); }\n"
    );

    expect(graph.hasEdge(svc, packageNodeId('axios'), 'imports')).toBe(true);
    expect(graph.hasEdge(symbolId(graph, 'run', svc), packageNodeId('pg'), 'calls')).toBe(true);
    expect(graph.nodeAttributes(packageNodeId('pg'))).toEqual({ kind: 'package', name: 'pg' });
    expect(graph.stats.callsExternal).toBe(2);
    expect(graph.files()).not.toContain(packageNodeId('pg'));

    graph.removeFile(fx.path('svc.ts'));
    expect(graph.nodeAttributes(packageNodeId('pg'))).toBeUndefined();
  });

  it('cobertura: import quebrado e export inexistente contam como não resolvidos', () => {
    indexFile(graph, fx, 'repo.ts', 'export function save() {}\n');
    const svc = indexFile(graph, fx, 'svc.ts', "import { nope } from './repo';\nimport { x } from './missing';\nexport function run() { nope(); x(); }\n");

    expect(graph.fileCoverage(svc)).toMatchObject({ callsUnresolved: 2, importsUnresolved: ['./missing'] });
  });

  it('receptor desconhecido cai no fallback por nome e a aresta fica marcada `heuristic`', () => {
    const repo = indexFile(graph, fx, 'repo.ts', 'export class Repo { save() {} }\n');
    const svc = indexFile(graph, fx, 'svc.ts', "import './repo';\nexport function run(r: any) { r.save(); }\n");

    const edge = graph
      .getImpactSubgraph(svc, 2)
      .edges.find((e) => e.source === symbolId(graph, 'run', svc) && e.target === symbolId(graph, 'save', repo));
    expect(edge?.attributes).toEqual({ type: 'calls', heuristic: true });
    expect(graph.stats.callsHeuristic).toBe(1);
  });
});

describe('ModuleResolver / utilitários', () => {
  it('packageName', () => {
    expect(packageName('@prisma/client/runtime')).toBe('@prisma/client');
    expect(packageName('lodash/fp')).toBe('lodash');
    expect(packageName('node:fs')).toBe('node:fs');
  });

  it('parseJsonc ignora comentários e vírgula final sem mexer em strings', () => {
    expect(parseJsonc('{ "a": "http://x//y", /* c */ "b": [1,], }')).toEqual({ a: 'http://x//y', b: [1] });
    // vírgula "final" dentro de string não é tocada
    expect(parseJsonc('{ "p": "a,}", "q": ["x,]" , ] }')).toEqual({ p: 'a,}', q: ['x,]'] });
  });

  it('sem tsconfig, especificador não relativo é pacote', () => {
    const resolver = new ModuleResolver({ isFile: () => false });
    expect(resolver.resolve(path.resolve('/p/a.ts'), 'express')).toEqual({ kind: 'package', name: 'express' });
    expect(resolver.resolve(path.resolve('/p/a.ts'), './b')).toEqual({ kind: 'unresolved' });
  });
});
