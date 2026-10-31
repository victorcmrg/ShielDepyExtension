// MVP6: o corpo de exemplo de cada rota sai dos campos que a cadeia de handlers lê de `req.body`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chaosConfigPending,
  chaosConfigScaffold,
  findExpressRoutes,
  isSymbolNode,
  routeBodyReads,
  sampleBody,
  sampleValue,
  TsParser,
  type AttackSurface,
  type CodeGraph,
} from '../src/index';
import { defaultWasmDir } from '../src/wasm-path';
import { createGraph, Fixture, indexFile, symbolId } from './helpers';

const reads = (graph: CodeGraph, name: string, file: string) => {
  const attrs = graph.nodeAttributes(symbolId(graph, name, file));
  return attrs && isSymbolNode(attrs) ? attrs.bodyReads : undefined;
};

describe('MVP6 — o que a função lê de req.body', () => {
  let graph: CodeGraph;
  let fx: Fixture;

  beforeEach(async () => {
    graph = await createGraph();
    fx = new Fixture();
  });
  afterEach(() => fx.cleanup());

  it('acesso direto, desestruturação (renomeada, com padrão e aninhada), apelido e o corpo embrulhado', () => {
    const f = indexFile(
      graph,
      fx,
      'h.ts',
      [
        'export function direct(req, res) { return req.body.user.email + req.body.user.name + req.body.items.map((i) => i) + req.body.tags.length; }',
        'export function destructured(req, res) { const { productId, qty: quantity, note = "", address: { zip }, posts } = req.body; return posts?.map((p) => p); }',
        'export function aliased(request, res) { const body = request.body; return body.cardToken; }',
        'export async function wrapped(req, reply) { const { priceCents } = (req.body ?? {}) as Record<string, any>; return req.body!.coupon; }',
        // o 2º parâmetro (ou outro objeto) com .body não é a requisição
        'export function other(ctx, res) { return res.body.x; }',
        'export function none(req, res) { return req.params.id; }',
      ].join('\n')
    );
    expect(reads(graph, 'direct', f)).toEqual(['items[]', 'tags[]', 'user.email', 'user.name']);
    expect(reads(graph, 'destructured', f)).toEqual(['address.zip', 'note', 'posts[]', 'productId', 'qty']);
    expect(reads(graph, 'aliased', f)).toEqual(['cardToken']);
    expect(reads(graph, 'wrapped', f)).toEqual(['coupon', 'priceCents']);
    expect(reads(graph, 'other', f)).toBeUndefined();
    expect(reads(graph, 'none', f)).toBeUndefined();
  });

  it('um nível para dentro: o pedaço do corpo passado a um serviço (direto, espalhado ou inteiro) vale o que o serviço lê', () => {
    indexFile(
      graph,
      fx,
      'service.ts',
      [
        'export const createArticle = async (article: any, id: number) => { const { title, body } = article; return title + body + id; };',
        'export const createUser = async (input: { email: string; password: string }) => input.email?.trim() + input.password;',
        'export class Orders { async checkout(o: any) { return o.productId + o.quantity; } }',
      ].join('\n')
    );
    indexFile(
      graph,
      fx,
      'routes.ts',
      [
        "import express from 'express';",
        "import { createArticle, createUser, Orders } from './service';",
        'const orders = new Orders();',
        'const app = express();',
        "app.post('/articles', async (req, res) => { res.json(await createArticle(req.body.article, 1)); });",
        "app.post('/users', async (req, res) => { res.json(await createUser({ ...req.body.user, demo: false })); });",
        "app.post('/orders', async (req, res) => { res.json(await orders.checkout(req.body as any)); });",
      ].join('\n')
    );
    const bodies = routeBodyReads(graph, findExpressRoutes(graph).routes);
    expect(bodies['POST /articles']?.paths).toEqual(['article.body', 'article.title']);
    expect(bodies['POST /users']?.paths).toEqual(['user.email', 'user.password']);
    expect(bodies['POST /orders']?.paths).toEqual(['productId', 'quantity']);
  });

  it('a rota junta o que o middleware e o handler leem, com os rótulos de quem leu', () => {
    indexFile(
      graph,
      fx,
      'app.ts',
      [
        "import express from 'express';",
        'function validate(req, res, next) { const { email, password } = req.body; next(); }',
        'class Ctrl { create = async (req, res) => { res.json({ name: req.body.name }); }; }',
        'const ctrl = new Ctrl();',
        'const app = express();',
        "app.post('/users', express.json(), validate, ctrl.create);",
        "app.get('/users', (req, res) => res.end());",
      ].join('\n')
    );
    expect(routeBodyReads(graph, findExpressRoutes(graph).routes)).toEqual({
      'POST /users': { paths: ['email', 'name', 'password'], from: ['validate', 'ctrl.create'] },
      // o handler do projeto não lê nem repassa o corpo: a rota não usa corpo
      'GET /users': { paths: [], from: [] },
    });
  });
});

describe('MVP6 — o corpo de exemplo', () => {
  it('valores pelo nome do campo', () => {
    expect(sampleValue('productId')).toBe('1');
    expect(sampleValue('user_ids')).toEqual(['1']);
    expect(sampleValue('email')).toBe('teste@exemplo.com');
    expect(sampleValue('cardToken')).toBe('tok_test');
    expect(sampleValue('priceCents')).toBe(1);
    expect(sampleValue('quantity')).toBe(1);
    expect(sampleValue('isActive')).toBe(true);
    expect(sampleValue('createdAt')).toBe('2026-01-01T00:00:00.000Z');
    expect(sampleValue('title')).toBe('teste');
    expect(sampleBody(['user.email', 'user.name', 'quantity', 'tags[]'])).toEqual({ quantity: 1, tags: [], user: { email: 'teste@exemplo.com', name: 'teste' } });
  });

  it('o contrato leva o corpo, sem a pendência do corpo; sem leitura, a pendência continua', async () => {
    const parser = await TsParser.load(defaultWasmDir());
    const route = (id: string) => ({ id, method: id.split(' ')[0]!, path: id.split(' ')[1]!, at: 'src/r.ts:3', handlers: [], operations: [], tags: [], collisions: [], confidence: 'proven' as const });
    const surface: AttackSurface = { version: 1, topologyHash: 'x', collisions: [], routes: [route('POST /checkout'), route('PUT /orders/:id')] };
    const source = chaosConfigScaffold(surface, { bodies: { 'POST /checkout': { paths: ['cardToken', 'productId', 'quantity'], from: ['validateCheckout'] } } });
    expect(parser.withTree(source, false, (r) => r.hasError)).toBe(false);
    expect(source).toContain(
      "'POST /checkout': { path: '/checkout', body: { cardToken: 'tok_test', productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout lê (confira os valores) (src/r.ts:3)"
    );
    expect(source).toContain("'PUT /orders/:id': { path: '/orders/1', body: {} }, // TODO(shieldepy): um corpo válido");
    // createApp, reset e o corpo do PUT
    expect(chaosConfigPending(source)).toBe(3);
  });
});
