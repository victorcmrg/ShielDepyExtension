import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSystemGraph, buildTopology, classifySql, findExpressRoutes, ioOperationOf, type CallSite, type CodeGraph, type IoOperation, type Route } from '../src/index';
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

// M2: as rotas que os boilerplates registram de um jeito que o mapa não lia (19 rotas sem caminho e
// todas sem o prefixo `/v1`).
describe('M2 — rotas que o mapa não lia', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('`router.route(path).get(...).patch(...)`: cada verbo da cadeia no caminho da `.route()`', () => {
    const r = indexFile(
      graph,
      fx,
      'user.route.js',
      [
        "const express = require('express');",
        'const ctrl = { get() {}, update() {}, list() {} };',
        'function auth() { return (req, res, next) => next(); }',
        'const router = express.Router();',
        "router.route('/').get(auth(), ctrl.list);",
        "router\n  .route('/:userId')\n  .get(auth(), ctrl.get)\n  .patch(ctrl.update);",
        'router.route(dynamicPath).get(ctrl.get);',
        'module.exports = router;',
      ].join('\n')
    );
    const { routes, skipped } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual(['GET /: auth() → ctrl.list', 'GET /:userId: auth() → ctrl.get', 'PATCH /:userId: ctrl.update']);
    expect(routes[2]!.handlers[0]!.symbols).toEqual([memberId(graph, 'ctrl', 'update', r)]);
    expect(skipped.map((s) => s.reason)).toEqual(['route(): caminho não literal']);
  });

  it('roteador montado por variável de `require` (`const userRoutes = require(...)`)', () => {
    indexFile(graph, fx, 'routes/user.route.js', "const router = require('express').Router();\nrouter.get('/profile', (req, res) => {});\nmodule.exports = router;\n");
    indexFile(graph, fx, 'routes/index.js', "const router = require('express').Router();\nconst userRoutes = require('./user.route');\nrouter.use('/users', userRoutes);\nmodule.exports = router;\n");
    indexFile(graph, fx, 'app.js', "const express = require('express');\nconst routes = require('./routes');\nconst app = express();\napp.use('/v1', routes);\n");
    expect(findExpressRoutes(graph).routes.map(show)).toEqual(['GET /v1/users/profile: <inline>']);
  });

  it('montagem em laço: `routes.forEach((r) => router.use(r.path, r.route))` sobre uma lista do topo', () => {
    indexFile(graph, fx, 'v1/auth.route.js', "const router = require('express').Router();\nrouter.post('/login', (req, res) => {});\nmodule.exports = router;\n");
    indexFile(graph, fx, 'v1/user.route.js', "const router = require('express').Router();\nrouter.get('/', (req, res) => {});\nmodule.exports = router;\n");
    indexFile(
      graph,
      fx,
      'v1/index.js',
      [
        "const express = require('express');",
        "const authRoute = require('./auth.route');",
        "const userRoute = require('./user.route');",
        'const router = express.Router();',
        'const defaultRoutes = [',
        "  { path: '/auth', route: authRoute },",
        "  { path: '/users', route: userRoute },",
        '];',
        'defaultRoutes.forEach((route) => {',
        '  router.use(route.path, route.route);',
        '});',
        'module.exports = router;',
      ].join('\n')
    );
    indexFile(graph, fx, 'app.js', "const express = require('express');\nconst routes = require('./v1');\nconst app = express();\napp.use('/v1', routes);\n");
    expect(findExpressRoutes(graph).routes.map(show)).toEqual(['POST /v1/auth/login: <inline>', 'GET /v1/users: <inline>']);
  });
});

// M3: nos dois boilerplates com Mongoose, nenhuma rota era sensível (0 operações de I/O).
describe('M3 — Mongoose como I/O e handlers embrulhados', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  const USER_MODEL = [
    "const mongoose = require('mongoose');",
    'const userSchema = mongoose.Schema({ email: String, name: String });',
    'userSchema.statics.isEmailTaken = async function (email) { return !!(await this.findOne({ email })); };',
    'userSchema.method({ transform() { return { id: this.id }; } });',
    "const User = mongoose.model('User', userSchema);",
    'module.exports = User;',
  ].join('\n');

  it('operações pelo modelo: estático, documento (`new`, consulta com `.exec()`), `this` num estático e transação', () => {
    const model = indexFile(graph, fx, 'models/user.model.js', USER_MODEL);
    const f = indexFile(
      graph,
      fx,
      'services/user.service.js',
      [
        "const mongoose = require('mongoose');",
        "const User = require('../models/user.model');",
        'async function rename(id, name) {',
        '  const session = await mongoose.startSession();',
        '  session.startTransaction();',
        '  const user = await User.findById(id).exec();',
        '  user.name = name;',
        '  await user.save();',
        '  await session.commitTransaction();',
        '  return user.transform();',
        '}',
        'async function register(body) { return new User(body).save(); }',
        'async function purge() { await User.deleteMany({}); }',
      ].join('\n')
    );
    expect(ops(graph, f)).toEqual([
      { kind: 'db_tx', target: 'transaction', via: 'mongoose', operation: 'startTransaction' },
      { kind: 'db_read', target: 'User', via: 'mongoose', operation: 'findById' },
      { kind: 'db_write', target: 'User', via: 'mongoose', operation: 'save' },
      { kind: 'db_tx', target: 'transaction', via: 'mongoose', operation: 'commitTransaction' },
      { kind: 'db_write', target: 'User', via: 'mongoose', operation: 'save' },
      { kind: 'db_write', target: 'User', via: 'mongoose', operation: 'deleteMany' },
    ]);
    // o `this.findOne()` do estático também é leitura do User; e o método do documento é do schema
    expect(ops(graph, model)).toEqual([{ kind: 'db_read', target: 'User', via: 'mongoose', operation: 'findOne' }]);
    expect(site(graph, f, 'user.transform').targets).toEqual([memberId(graph, 'userSchema.methods', 'transform', model)]);
  });

  it('handler embrulhado (`catchAsync(fn)`, `asyncHandler(fn)`): a rota chega ao banco e ganha as tags', () => {
    indexFile(graph, fx, 'models/user.model.js', USER_MODEL);
    indexFile(
      graph,
      fx,
      'controllers/user.controller.js',
      [
        "const User = require('../models/user.model');",
        'const catchAsync = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);',
        'const updateUser = catchAsync(async (req, res) => {',
        '  const user = await User.findById(req.params.id);',
        '  Object.assign(user, req.body);',
        '  await user.save();',
        '  res.send(user);',
        '});',
        'module.exports = { updateUser };',
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'routes/user.route.js',
      [
        "const express = require('express');",
        "const asyncHandler = require('express-async-handler');",
        "const userController = require('../controllers/user.controller');",
        "const User = require('../models/user.model');",
        'const router = express.Router();',
        "router.patch('/users/:id', userController.updateUser);",
        "router.get('/users', asyncHandler(async (req, res) => { res.send(await User.find()); }));",
        'module.exports = router;',
      ].join('\n')
    );
    const t = buildTopology(graph, buildSystemGraph(graph, [], fx.dir), fx.dir);
    const show = (id: string) => {
      const r = t.routes.find((x) => x.id === id)!;
      return [r.handlers.map((h) => h.label).join(' → '), ...r.operations.map((o) => `${o.kind} ${o.target} ${o.operation}`), ...r.tags.map((x) => x.tag)];
    };
    expect(show('PATCH /users/:id')).toEqual([
      'userController.updateUser',
      'db_read User findById',
      'db_write User save',
      'no-transaction',
      'read-then-write',
    ]);
    expect(show('GET /users')).toEqual(['asyncHandler(<inline>)', 'db_read User find']);
  });
});

// M5a: mais 5 projetos (hackathon-starter, bulletproof, proshop-v2, o jwt-auth do bezkoder e o
// mern-memories). O do bezkoder dava 1 rota de 7 e nenhuma operação.
describe('M5a — o que mais 5 projetos mostraram', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('rotas num parâmetro `app` (`module.exports = function (app) {}` + `require(...)(app)`), com middlewares em lista', () => {
    indexFile(
      graph,
      fx,
      'app/routes/auth.routes.js',
      [
        "const controller = require('../controllers/auth.controller');",
        "const verify = require('../middlewares/verify');",
        'module.exports = function (app) {',
        '  app.use(function (req, res, next) { next(); });',
        "  app.post('/api/auth/signup', [verify.checkDuplicate, verify.checkRoles], controller.signup);",
        '};',
      ].join('\n')
    );
    indexFile(graph, fx, 'app/controllers/auth.controller.js', 'exports.signup = (req, res) => {};\n');
    indexFile(graph, fx, 'app/middlewares/verify.js', 'const checkDuplicate = (req, res, next) => next();\nconst checkRoles = (req, res, next) => next();\nmodule.exports = { checkDuplicate, checkRoles };\n');
    // função com `app` que ninguém chama com um roteador: não vira rota (o parâmetro pode ser qualquer coisa)
    indexFile(graph, fx, 'app/unused.js', "module.exports = function (app) { app.get('/nunca', () => {}); };\n");
    indexFile(
      graph,
      fx,
      'server.js',
      ["const express = require('express');", 'const app = express();', 'app.use(express.json());', "require('./app/routes/auth.routes')(app);", 'app.listen(3000);'].join('\n')
    );
    expect(findExpressRoutes(graph).routes.map(show)).toEqual([
      'POST /api/auth/signup: express.json() → <inline> → verify.checkDuplicate → verify.checkRoles → controller.signup',
    ]);
  });

  it('objeto de modelos montado por atribuição (`db.user = require(...)`) e `const User = db.user`', () => {
    indexFile(graph, fx, 'models/user.model.js', "const mongoose = require('mongoose');\nconst User = mongoose.model('User', new mongoose.Schema({}));\nmodule.exports = User;\n");
    indexFile(graph, fx, 'models/index.js', "const db = {};\ndb.mongoose = require('mongoose');\ndb.user = require('./user.model');\nmodule.exports = db;\n");
    const f = indexFile(
      graph,
      fx,
      'controllers/auth.js',
      [
        "const db = require('../models');",
        'const User = db.user;',
        'exports.signup = async (body) => {',
        '  const user = new User(body);',
        '  await user.save();',
        '  return User.findOne({ email: body.email });',
        '};',
      ].join('\n')
    );
    expect(ops(graph, f)).toEqual([
      { kind: 'db_write', target: 'User', via: 'mongoose', operation: 'save' },
      { kind: 'db_read', target: 'User', via: 'mongoose', operation: 'findOne' },
    ]);
    expect(site(graph, f, 'User')).toMatchObject({ outcome: 'external', package: 'mongoose' }); // new User(body)
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });

  it('`const user = new User(b); user.save()` com o modelo importado direto (o "tipo" é o modelo)', () => {
    indexFile(graph, fx, 'user.model.js', "const mongoose = require('mongoose');\nmodule.exports = mongoose.model('User', new mongoose.Schema({}));\n");
    const f = indexFile(graph, fx, 'svc.js', "const User = require('./user.model');\nasync function add(b) { const user = new User(b); await user.save(); }\n");
    expect(ops(graph, f)).toEqual([{ kind: 'db_write', target: 'User', via: 'mongoose', operation: 'save' }]);
  });

  it('CSS "gerado" (uma linha longa) importado pelo código: o mapa é o mesmo em qualquer ordem', async () => {
    const css = `body { background: url("data:image/svg+xml,${'%3C'.repeat(1500)}"); }\n`;
    fx.write('src/index.css', css);
    fx.write('src/index.js', "import './index.css';\nexport const x = 1;\n");
    const snapshotOf = async (order: string[]) => {
      const g = await createGraph();
      for (const rel of order) g.updateFile(fx.path(rel), rel.endsWith('.css') ? css : "import './index.css';\nexport const x = 1;\n");
      return JSON.stringify(g.toSnapshot());
    };
    expect(await snapshotOf(['src/index.js', 'src/index.css'])).toBe(await snapshotOf(['src/index.css', 'src/index.js']));
  });
});

// M5b: o que sobrava no proshop (frontend com Redux Toolkit, 38 sem alvo) e no hackathon-starter
// (173 por nome, a maioria nos testes e nos hooks do modelo).
describe('M5b — desestruturação exportada, hooks do Mongoose e `require` atribuído', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('`export const { useGetOrderQuery } = orderApiSlice` e `const { logout } = authSlice.actions`: membros do valor', () => {
    indexFile(graph, fx, 'slices/apiSlice.js', "import { createApi } from '@reduxjs/toolkit/query/react';\nexport const apiSlice = createApi({});\n");
    indexFile(
      graph,
      fx,
      'slices/ordersApiSlice.js',
      "import { apiSlice } from './apiSlice';\nexport const orderApiSlice = apiSlice.injectEndpoints({});\nexport const { useGetOrderQuery, usePayOrderMutation: usePay } = orderApiSlice;\n"
    );
    indexFile(graph, fx, 'slices/authSlice.js', "import { createSlice } from '@reduxjs/toolkit';\nconst authSlice = createSlice({});\nexport const { logout } = authSlice.actions;\n");
    const f = indexFile(
      graph,
      fx,
      'screens/Order.jsx',
      "import { useGetOrderQuery, usePay } from '../slices/ordersApiSlice';\nimport { logout } from '../slices/authSlice';\nexport function Order() { useGetOrderQuery(1); usePay(); logout(); }\n"
    );
    expect(site(graph, f, 'useGetOrderQuery')).toMatchObject({ outcome: 'external', package: '@reduxjs/toolkit' });
    expect(site(graph, f, 'usePay')).toMatchObject({ outcome: 'external', package: '@reduxjs/toolkit' });
    expect(site(graph, f, 'logout')).toMatchObject({ outcome: 'external', package: '@reduxjs/toolkit' });
    expect(graph.fileCoverage(f)).toMatchObject({ callsUnresolved: 0, callsHeuristic: 0 });
  });

  it('hooks do schema (`pre`/`post`) e `this.constructor.x()`: o `this` é o documento; `router.post` não é hook', () => {
    const model = indexFile(
      graph,
      fx,
      'models/User.js',
      [
        "const mongoose = require('mongoose');",
        'const userSchema = new mongoose.Schema({});',
        "userSchema.statics.hashIP = function (ip) { return ip; };",
        "userSchema.methods.clearToken = function (kind) { this[kind] = undefined; };",
        "userSchema.methods.verify = function (ip) { return this.constructor.hashIP(ip); };",
        "userSchema.pre('save', function clearExpired() { this.clearToken('login'); });",
        "const User = mongoose.model('User', userSchema);",
        'module.exports = User;',
      ].join('\n')
    );
    const routes = indexFile(graph, fx, 'routes.js', "const router = require('express').Router();\nrouter.post('/login', function login(req, res) { res.end(); });\n");
    expect(site(graph, model, 'this.clearToken').targets).toEqual([memberId(graph, 'userSchema.methods', 'clearToken', model)]);
    expect(site(graph, model, 'this.constructor.hashIP').targets).toEqual([memberId(graph, 'userSchema.statics', 'hashIP', model)]);
    expect(memberId(graph, 'userSchema.hooks', 'clearExpired', model)).toBeTruthy();
    // a rota continua função comum (sem contêiner), e continua rota
    expect(graph.ownedSymbols(routes).map((id) => graph.nodeAttributes(id)).filter((a) => a?.kind === 'method')).toEqual([]);
    expect(findExpressRoutes(graph).routes.map((r) => r.id)).toEqual(['POST /login']);
  });

  it('`let ctrl; ... ctrl = require(...)` (teste que recarrega o módulo) resolve como import', () => {
    const svc = indexFile(graph, fx, 'controllers/user.js', 'exports.getUser = async () => {};\n');
    const f = indexFile(
      graph,
      fx,
      'test/user.test.js',
      "describe('user', () => {\n  let userController;\n  beforeEach(() => { userController = require('../controllers/user'); });\n  it('x', async () => { await userController.getUser(); });\n});\n"
    );
    expect(site(graph, f, 'userController.getUser').targets).toEqual([symbolId(graph, 'getUser', svc)]);
  });
});
