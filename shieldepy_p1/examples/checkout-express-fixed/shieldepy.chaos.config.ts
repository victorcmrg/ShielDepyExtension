// Contrato do projeto com o ShielDepy (E3/E4). Os testes de caos são gerados a partir da
// topologia, mas só o projeto sabe: como subir o app sem porta, como zerar o estado, o que
// nunca pode acontecer (invariantes) e como é uma requisição válida de cada rota.
import { minStock, orderCount, resetDb } from './chaos/db';
import { createApp } from './src/app';

export default {
  createApp,
  /** Carregados antes de cada teste gerado (aqui: troca o `pg` pelo banco em memória). */
  setupFiles: ['chaos/setup.ts'],
  /** Estado antes de cada teste: um único item em estoque — o cenário em que a corrida aparece. */
  async reset(): Promise<void> {
    await resetDb({ 'p-1': 1 });
  },
  invariants: {
    /** Nunca vender o que não tem. */
    async stockNeverNegative(): Promise<boolean> {
      return (await minStock()) >= 0;
    },
    /** Com 1 item em estoque, no máximo 1 pedido. */
    async atMostOneOrder(): Promise<boolean> {
      return (await orderCount()) <= 1;
    },
  },
  /** Uma requisição válida por rota (o id é o da topologia). Sem isso, todo teste pararia na validação. */
  requests: {
    'POST /checkout': { path: '/checkout', body: { productId: 'p-1', quantity: 1, priceCents: 1990, cardToken: 'tok_visa' } },
    'GET /orders/:id': { path: '/orders/1' },
  },
};
