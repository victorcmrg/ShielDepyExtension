// Prova que o exemplo roda em memória (pg-mem + MSW) e que o defeito plantado é real — não só
// uma tag da topologia. Os testes de caos gerados pela E3 partem deste mesmo arranjo.
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import config from '../shieldepy.chaos.config';

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
afterAll(() => stripe.close());
beforeEach(() => config.reset());

const app = config.createApp();
const checkout = config.requests['POST /checkout'];

describe('checkout-express em memória', () => {
  it('compra com estoque: 201, pedido gravado e GET /orders/:id devolve o pedido', async () => {
    const res = await request(app).post(checkout.path).send(checkout.body);
    expect(res.status).toBe(201);
    expect(await config.invariants.stockNeverNegative()).toBe(true);
    const order = await request(app).get(`/orders/${res.body.id}`);
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({ productId: 'p-1', chargeId: 'ch_1' });
  });

  it('sem estoque: 409', async () => {
    await request(app).post(checkout.path).send(checkout.body);
    const second = await request(app).post(checkout.path).send(checkout.body);
    expect(second.status).toBe(409);
  });

  it('o defeito é real: 10 compras simultâneas do último item vendem mais de uma vez', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => request(app).post(checkout.path).send(checkout.body)));
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThan(1);
    expect(await config.invariants.stockNeverNegative()).toBe(false);
  });
});
