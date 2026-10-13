import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifySql, findExpressRoutes, ioOperationOf, type CallSite, type CodeGraph, type IoOperation, type Route } from '../src/index';
import { createGraph, Fixture, indexFile, symbolId } from './helpers';

/** `GET /x: a → b` — a cadeia de handlers numa linha. */
const show = (r: Route) => `${r.id}: ${r.handlers.map((h) => h.label).join(' → ')}`;

/** A chamada `obj.name` do arquivo (a 1ª). */
function site(graph: CodeGraph, file: string, chain: string): CallSite {
  const found = graph.callSitesIn(file).find((s) => [...(s.object ?? []), s.name].join('.') === chain);
  if (!found) throw new Error(`chamada ${chain} não encontrada`);
  return found;
}

/** As operações de I/O do arquivo, sem a posição. */
function ops(graph: CodeGraph, file: string) {
  return graph
    .callSitesIn(file)
    .map((s) => ioOperationOf(s, file))
    .filter((o): o is IoOperation => !!o)
    .map(({ symbol: _s, file: _f, line: _l, ...rest }) => rest);
}

/** Método `name` do contêiner (classe ou objeto) no arquivo. */
function memberId(graph: CodeGraph, container: string, name: string, file: string): string {
  const id = graph.ownedSymbols(file).find((s) => {
    const a = graph.nodeAttributes(s);
    return a?.kind === 'method' && a.container === container && a.name === name;
  });
  if (!id) throw new Error(`${container}.${name} não encontrado`);
  return id;
}

// C1 do plano: o motor em 3 projetos Express reais (realworld, prisma-examples, CRUD com pg).
// Cada teste é o padrão que um deles usava e que o mapa não via.
describe('C1 — padrões de projetos Express reais', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('1. `global.prisma || new PrismaClient()` dá o tipo do cliente (o singleton de desenvolvimento)', () => {
    const f = indexFile(
      graph,
      fx,
      'db.ts',
      [
        "import { PrismaClient } from '@prisma/client';",
        'declare const global: { prisma?: PrismaClient };',
        'const prisma = global.prisma ?? (new PrismaClient());',
        'export async function list() { return prisma.article.findMany(); }',
      ].join('\n')
    );
    expect(site(graph, f, 'prisma.article.findMany')).toMatchObject({ outcome: 'external', package: '@prisma/client' });
    expect(ops(graph, f)).toEqual([{ kind: 'db_read', target: 'article', via: 'prisma', operation: 'findMany' }]);
  });

  it('2. `require(x)` como receptor: pacote vira externo, arquivo vira o export dele', () => {
    indexFile(graph, fx, 'svc.js', 'function create() {}\nmodule.exports = { create };\n');
    const f = indexFile(graph, fx, 'app.js', "const r = require('express').Router();\nfunction go() { require('./svc').create(); }\n");
    expect(site(graph, f, 'Router')).toMatchObject({ outcome: 'external', package: 'express' });
    expect(site(graph, f, 'create')).toMatchObject({ outcome: 'resolved' });
  });

  it('3 e 4. montagem por `require()` e roteador sem nome (`Router().use(a).use(b)`, `export default Router()...`)', () => {
    indexFile(graph, fx, 'routes/users.js', "const router = require('express').Router();\nrouter.get('/users', (req, res) => {});\nmodule.exports = router;\n");
    indexFile(
      graph,
      fx,
      'routes/index.ts',
      ["import { Router } from 'express';", "import tags from './tags';", "export default Router().use(tags).use('/v1', require('./users'));"].join('\n')
    );
    indexFile(graph, fx, 'routes/tags.ts', "import { Router } from 'express';\nconst api = Router().get('/tags', (req, res) => {});\nexport default api;\n");
    indexFile(graph, fx, 'app.ts', "import express from 'express';\nimport routes from './routes';\nconst app = express();\napp.use('/api', routes);\n");
    expect(findExpressRoutes(graph).routes.map(show)).toEqual(['GET /api/tags: <inline>', 'GET /api/v1/users: <inline>']);
  });

  it('5. SQL no formato objeto: `pool.query({ text, values })`', () => {
    const f = indexFile(
      graph,
      fx,
      'repo.js',
      "const { Pool } = require('pg');\nconst pool = new Pool();\nasync function find(id) { return pool.query({ text: 'SELECT * FROM product WHERE id = $1', values: [id] }); }\n"
    );
    expect(ops(graph, f)).toEqual([{ kind: 'db_read', target: 'product', via: 'pg', operation: 'SELECT' }]);
  });

  it('6. a tabela lida é a do FROM de fora, não a da subconsulta', () => {
    expect(classifySql('SELECT p.*, (SELECT name FROM category c WHERE c.id = p.category_id) FROM product p').table).toBe('product');
    expect(classifySql('SELECT * FROM (SELECT * FROM orders) o').table).toBe('orders');
  });

  it('7. cliente gerado do Prisma 7 (`output` do schema.prisma) é o `@prisma/client`', () => {
    fx.write('package.json', '{"name":"x"}');
    fx.write('prisma/schema.prisma', 'generator client {\n  provider = "prisma-client"\n  output   = "../generated/client" // gerado\n}\n');
    const f = indexFile(
      graph,
      fx,
      'src/index.ts',
      "import { PrismaClient } from '../generated/client';\nconst prisma = new PrismaClient();\nexport async function add() { await prisma.user.create({ data: {} }); }\n"
    );
    expect(ops(graph, f)).toEqual([{ kind: 'db_write', target: 'user', via: 'prisma', operation: 'create' }]);
  });
});

// M1: o que os boilerplates em CommonJS com Mongoose mostraram (hagopj13/node-express-boilerplate e
// danielfsousa/express-rest-boilerplate): 87% e 42% das chamadas provadas antes, 100% e 90% depois.
describe('M1 — CommonJS e Mongoose no mapa', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('`module.exports = app` com `app = express()`: quem faz `require` chama métodos do express', () => {
    indexFile(graph, fx, 'config/express.js', "const express = require('express');\nconst app = express();\nmodule.exports = app;\n");
    indexFile(graph, fx, 'config/logger.js', "const winston = require('winston');\nmodule.exports = winston.createLogger({});\n");
    const f = indexFile(
      graph,
      fx,
      'index.js',
      "const app = require('./config/express');\nconst logger = require('./config/logger');\nfunction start() { app.listen(3000, () => logger.info('ok')); }\n"
    );
    expect(site(graph, f, 'app.listen')).toMatchObject({ outcome: 'external', package: 'express' });
    expect(site(graph, f, 'logger.info')).toMatchObject({ outcome: 'external', package: 'winston' });
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });

  it('modelo do Mongoose: estáticos do projeto (objeto ou atribuição) resolvidos; o resto é do pacote', () => {
    const model = indexFile(
      graph,
      fx,
      'models/user.model.js',
      [
        "const mongoose = require('mongoose');",
        'const userSchema = new mongoose.Schema({ email: String });',
        'userSchema.statics = {',
        '  async get(id) { return this.findById(id); },',
        '};',
        'userSchema.statics.isEmailTaken = async function (email) { return !!(await this.findOne({ email })); };',
        "const User = mongoose.model('User', userSchema);",
        'module.exports = User;',
      ].join('\n')
    );
    const f = indexFile(
      graph,
      fx,
      'controllers/user.js',
      [
        "const User = require('../models/user.model');",
        'async function load(id) { return User.get(id); }',
        'async function create(body) {',
        '  if (await User.isEmailTaken(body.email)) return null;',
        '  const user = new User(body);',
        '  return User.findOne({ email: body.email });',
        '}',
      ].join('\n')
    );
    expect(site(graph, f, 'User.get').targets).toEqual([memberId(graph, 'userSchema.statics', 'get', model)]);
    expect(site(graph, f, 'User.isEmailTaken').targets).toEqual([memberId(graph, 'userSchema.statics', 'isEmailTaken', model)]);
    expect(site(graph, f, 'User.findOne')).toMatchObject({ outcome: 'external', package: 'mongoose' });
    expect(site(graph, f, 'User')).toMatchObject({ outcome: 'external', package: 'mongoose' }); // new User(body)
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });

  it('barrel CommonJS (`module.exports.x = require()`): módulo de funções e valor único', () => {
    const svc = indexFile(graph, fx, 'services/user.service.js', 'const createUser = async () => {};\nmodule.exports = { createUser };\n');
    indexFile(graph, fx, 'services/index.js', "module.exports.userService = require('./user.service');\n");
    indexFile(graph, fx, 'models/token.model.js', "const mongoose = require('mongoose');\nmodule.exports = mongoose.model('Token', new mongoose.Schema({}));\n");
    indexFile(graph, fx, 'models/index.js', "module.exports.Token = require('./token.model');\n");
    const f = indexFile(
      graph,
      fx,
      'controllers/auth.js',
      [
        "const { userService } = require('../services');",
        "const { Token } = require('../models');",
        'async function register(body) { await userService.createUser(body); await Token.deleteMany({}); new Token({}); }',
      ].join('\n')
    );
    expect(site(graph, f, 'userService.createUser').targets).toEqual([symbolId(graph, 'createUser', svc)]);
    expect(site(graph, f, 'Token.deleteMany')).toMatchObject({ outcome: 'external', package: 'mongoose' });
    expect(site(graph, f, 'Token')).toMatchObject({ outcome: 'external', package: 'mongoose' });
  });

  it('`export * as svc from` + `import { svc }`: `svc.f()` resolve no módulo (ESM)', () => {
    const svc = indexFile(graph, fx, 'svc.ts', 'export function create() {}\n');
    indexFile(graph, fx, 'index.ts', "export * as svc from './svc';\n");
    const f = indexFile(graph, fx, 'app.ts', "import { svc } from './index';\nexport function go() { svc.create(); }\n");
    expect(site(graph, f, 'svc.create').targets).toEqual([symbolId(graph, 'create', svc)]);
  });

  it('dois arquivos que se exportam pelo valor um do outro não entram em laço', () => {
    indexFile(graph, fx, 'a.js', "const b = require('./b');\nmodule.exports = b.make();\n");
    const f = indexFile(graph, fx, 'b.js', "const a = require('./a');\nmodule.exports = a.make();\nfunction go() { a.run(); }\n");
    expect(site(graph, f, 'a.run').outcome).not.toBe('resolved');
  });
});
