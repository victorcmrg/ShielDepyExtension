import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findExpressRoutes, joinPath, type CodeGraph, type Route } from '../../src/index';
import { createGraph, Fixture, indexFile, symbolId } from '../helpers';

/** `GET /x: a → b` — a cadeia de handlers numa linha, pra comparar fácil. */
const show = (r: Route) => `${r.id}: ${r.handlers.map((h) => h.label).join(' → ')}`;

describe('E2/2b — rotas Express pelo receptor resolvido', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });

  afterEach(() => fx.cleanup());

  it('rota = verbo num valor do pacote express; `.post` de uma classe do projeto não é rota', () => {
    const f = indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        'class Mailer { post(to: string, body: string) {} }',
        'function create() {}',
        'const app = express();',
        "app.post('/orders', create);",
        "new Mailer().post('/not-a-route', 'x');",
      ].join('\n')
    );
    const { routes } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual(['POST /orders: create']);
    expect(routes[0]).toMatchObject({ method: 'POST', path: '/orders', file: f, line: 4 });
    expect(routes[0]!.handlers[0]!.symbols).toEqual([symbolId(graph, 'create', f)]);
  });

  it('prefixos compostos atravessando import, barrel e montagem aninhada', () => {
    indexFile(
      graph,
      fx,
      'routes/orders.ts',
      "import { Router } from 'express';\nimport { show } from '../handlers';\nexport const orders = Router();\norders.get('/:id', show);\norders.get('/', show);\n"
    );
    indexFile(graph, fx, 'routes/index.ts', "export * from './orders';\n");
    indexFile(graph, fx, 'handlers.ts', 'export function show() {}\n');
    indexFile(
      graph,
      fx,
      'api.ts',
      "import express from 'express';\nimport { orders } from './routes';\nexport const api = express.Router();\napi.use('/orders/', orders);\n"
    );
    indexFile(
      graph,
      fx,
      'app.ts',
      "import express from 'express';\nimport { api } from './api';\nexport function createApp() {\n  const app = express();\n  app.use('/api', api);\n  app.use('/v2/api', api);\n  return app;\n}\n"
    );
    expect(findExpressRoutes(graph).routes.map((r) => r.id)).toEqual([
      'GET /api/orders',
      'GET /api/orders/:id',
      'GET /v2/api/orders',
      'GET /v2/api/orders/:id',
    ]);
  });

  it('middlewares de `use`: só os registrados ANTES e dentro do prefixo', () => {
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        "import cors from 'cors';",
        'function auth() {}',
        'function adminOnly() {}',
        'function late() {}',
        'function handler() {}',
        'const app = express();',
        'const r = express.Router();',
        "r.get('/me', handler);",
        'app.use(cors());',
        'app.use(auth);',
        "app.use('/admin', adminOnly);",
        "app.use('/api', r);",
        'app.use(late);',
        "app.get('/health', (req, res) => {});",
      ].join('\n')
    );
    const { routes } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual([
      'GET /api/me: cors() → auth → handler',
      'GET /health: cors() → auth → late → <inline>',
    ]);
    const me = routes[0]!;
    expect(me.handlers.map((h) => !!h.middleware)).toEqual([true, true, false]);
    expect(me.handlers[0]).toMatchObject({ opaque: true });
  });

  it('CommonJS (`require`) e `express.Router()`; `app.get("env")` e path dinâmico não viram rota', () => {
    const f = indexFile(
      graph,
      fx,
      'app.js',
      [
        "const express = require('express');",
        'const router = express.Router();',
        'function list() {}',
        "router.get('/items', list);",
        'const base = "/x";',
        'router.get(base, list);',
        'const app = express();',
        "app.get('env');",
        "app.use('/v1', router);",
      ].join('\n')
    );
    const { routes, skipped } = findExpressRoutes(graph);
    expect(routes.map(show)).toEqual(['GET /v1/items: list']);
    expect(skipped).toEqual([{ file: f, line: 5, column: 0, reason: 'GET: caminho não literal' }]);
  });

  it('roteador num campo da classe (`this.router`) e montagem em ciclo não travam', () => {
    indexFile(
      graph,
      fx,
      'ctrl.ts',
      [
        "import { Router } from 'express';",
        'export class OrdersController {',
        '  router: Router = Router();',
        "  constructor() { this.router.post('/orders', this.create); }",
        '  create() {}',
        '}',
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'loop.ts',
      "import { Router } from 'express';\nconst a = Router();\nconst b = Router();\nfunction h() {}\na.use('/a', b);\nb.use('/b', a);\nb.get('/x', h);\n"
    );
    const ids = findExpressRoutes(graph).routes.map((r) => r.id);
    expect(ids).toContain('POST /orders');
    expect(ids).toContain('GET /a/x'); // sobe b → a e para antes de repetir b
    expect(ids.filter((id) => id.endsWith('/x'))).toEqual(['GET /a/x']);
  });

  it('joinPath', () => {
    expect(joinPath('', '/')).toBe('/');
    expect(joinPath('/api', '/')).toBe('/api');
    expect(joinPath('/api/', '/x')).toBe('/api/x');
    expect(joinPath('/api', 'x')).toBe('/api/x');
  });
});
