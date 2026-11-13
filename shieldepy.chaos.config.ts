// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Os testes de caos saem da topologia, mas só o projeto sabe: como subir o app sem abrir porta,
// como zerar o estado, o que nunca pode acontecer e como é uma requisição válida de cada rota.
// Complete as linhas marcadas abaixo (uma marca por pendência) e rode "ShielDepy: Testar Caos"
// (ou `shieldepy chaos .`). As invariantes são opcionais, mas são elas que provam corrida e estado.

import { resetDb } from './chaos/db';
// o app do projeto (express() em examples/checkout-express-fixed/src/app.ts:6)
import { createApp as projectApp } from './examples/checkout-express-fixed/src/app';

export default {
  /** Monta o app SEM abrir porta (os testes usam supertest): a fábrica `createApp` de examples/checkout-express-fixed/src/app.ts. */
  // outros apps no projeto: examples/checkout-express/src/app.ts:6, examples/checkout-fastify-fixed/src/app.ts:6, examples/checkout-fastify/src/app.ts:6. Troque o import se o certo for outro.
  createApp: () => projectApp(),
  /** Carregados antes de cada teste gerado: o `pg` do app vira o PGlite de chaos/db.ts. */
  setupFiles: ['chaos/setup.ts'],
  /** Estado limpo antes de cada teste: o banco com um registro de exemplo por tabela (e os dados que você puser no chaos/db.ts). */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */
  invariants: {
    // ex.: async estoqueNuncaNegativo() { return (await menorEstoque()) >= 0; },
  },
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    'api.stripe.com': () => ({}), // TODO(shieldepy): a resposta de sucesso desta API
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'GET /api/orders/:id': { path: '/api/orders/1' }, // parâmetro pelo registro de exemplo do chaos/db.ts (confira) (examples/checkout-fastify-fixed/src/routes/checkout.ts:10)
    'GET /api/orders/:id': { path: '/api/orders/1' }, // parâmetro pelo registro de exemplo do chaos/db.ts (confira) (examples/checkout-fastify/src/routes/checkout.ts:10)
    'GET /orders/:id': { path: '/orders/1' }, // parâmetro pelo registro de exemplo do chaos/db.ts (confira) (examples/checkout-express-fixed/src/routes/checkout.ts:10)
  'GET /orders/:id': { path: '/orders/1' }, // parâmetro pelo registro de exemplo do chaos/db.ts (confira) (examples/checkout-express/src/routes/checkout.ts:10)
    'POST /api/checkout': { path: '/api/checkout', body: { cardToken: 'tok_test', priceCents: 1, productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout, checkoutController.create lê (confira os valores) (examples/checkout-fastify-fixed/src/routes/checkout.ts:8)
    'POST /api/checkout': { path: '/api/checkout', body: { cardToken: 'tok_test', priceCents: 1, productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout, checkoutController.create lê (confira os valores) (examples/checkout-fastify/src/routes/checkout.ts:8)
    'POST /checkout': { path: '/checkout', body: { cardToken: 'tok_test', priceCents: 1, productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout, checkoutController.create lê (confira os valores) (examples/checkout-express-fixed/src/routes/checkout.ts:8)
    'POST /checkout': { path: '/checkout', body: { cardToken: 'tok_test', priceCents: 1, productId: '1', quantity: 1 } }, // corpo pelos campos que validateCheckout, checkoutController.create lê (confira os valores) (examples/checkout-express/src/routes/checkout.ts:8)
  },
};
