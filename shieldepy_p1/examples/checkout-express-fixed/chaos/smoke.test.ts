// Prova que a versão corrigida aguenta o que derruba a vulnerável: a corrida pelo último item e o
// Stripe falhando. Os testes de caos gerados (E3/E4) têm que passar aqui e falhar no vulnerável.
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import config from '../shieldepy.chaos.config';
import { minStock } from './db';

const stripe = setupServer(
  http.post('https://api.stripe.com/v1/charges', async () => {
    await delay(20);
    return HttpResponse.json({ id: 'ch_1', status: 'succeeded' });
  })
);

// o supertest fala com o app em 127.0.0.1: isso passa; qualquer outro host não mockado é erro
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
beforeAll(() =>
  stripe.listen({
    onUnhandledRequest: (req, print) => {
      if (!LOCAL_HOSTS.has(new URL(req.url).hostname)) print.error();
    },
  })
);
afterEach(() => stripe.resetHandlers());
afterAll(() => stripe.close());
beforeEach(() => config.reset());

const app = config.createApp();
const checkout = config.requests['POST /checkout'];

describe('checkout-express-fixed em memória', () => {
  it('compra com estoque: 201 e GET /orders/:id devolve o pedido', async () => {
    const res = await request(app).post(checkout.path).send(checkout.body);
    expect(res.status).toBe(201);
    const order = await request(app).get(`/orders/${res.body.id}`);
    expect(order.body).toMatchObject({ productId: 'p-1', chargeId: 'ch_1' });
  });

  it('10 compras simultâneas do último item: exatamente 1 venda, estoque 0', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => request(app).post(checkout.path).send(checkout.body)));
    expect(results.filter((r) => r.status === 201).length).toBe(1);
    expect(results.filter((r) => r.status === 409).length).toBe(9);
    expect(await minStock()).toBe(0);
    expect(await config.invariants.atMostOneOrder()).toBe(true);
  });

  it('Stripe fora do ar: 502 e o estoque reservado volta', async () => {
    stripe.use(http.post('https://api.stripe.com/v1/charges', () => new HttpResponse(null, { status: 503 })));
    const res = await request(app).post(checkout.path).send(checkout.body);
    expect(res.status).toBe(502);
    expect(await minStock()).toBe(1);
  });

  it('Stripe com resposta inválida: 502, sem pedido, estoque de volta', async () => {
    stripe.use(http.post('https://api.stripe.com/v1/charges', () => HttpResponse.text('<html>erro</html>')));
    const res = await request(app).post(checkout.path).send(checkout.body);
    expect(res.status).toBe(502);
    expect(await config.invariants.atMostOneOrder()).toBe(true);
    expect(await minStock()).toBe(1);
  });
});
