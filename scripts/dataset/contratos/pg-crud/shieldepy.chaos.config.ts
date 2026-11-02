// Contrato do projeto com o ShielDepy, gerado a partir do mapa do código.
// Os testes de caos saem da topologia, mas só o projeto sabe: como subir o app sem abrir porta,
// como zerar o estado, o que nunca pode acontecer e como é uma requisição válida de cada rota.
// Complete as linhas marcadas abaixo (uma marca por pendência) e rode "ShielDepy: Testar Caos"
// (ou `shieldepy chaos .`). As invariantes são opcionais, mas são elas que provam corrida e estado.

import { db, resetDb } from './chaos/db';
import { capturedApp } from './chaos/app';
// index.js monta o app (express() na linha 3) e não o exporta: ele é
// carregado só pelo efeito. O chaos/setup.ts guarda o app criado, e o listen() não abre porta.
import { createRequire } from 'node:module';

createRequire(import.meta.url)('./index.js');

export default {
  /** O app do projeto, sem abrir porta (os testes usam supertest). */
  createApp: () => capturedApp(),
  /** Carregados antes de cada teste gerado: o `pg` do app vira o PGlite de chaos/db.ts; o `express` guarda o app sem abrir porta. */
  setupFiles: ['chaos/setup.ts'],
  // TODO(shieldepy): o projeto não tem .sql de esquema; escreva os CREATE TABLE em chaos/schema.sql
  /** Estado limpo antes de cada teste: o banco vazio (e os dados que as requisições abaixo usam, no chaos/db.ts). */
  async reset(): Promise<void> {
    await resetDb();
  },
  /** O que nunca pode acontecer: cada função devolve true quando está tudo certo. */
  invariants: {
    async categoriaSemNomeRepetido() {
      const r = await db.query('SELECT COUNT(*)::int AS n FROM (SELECT name FROM category GROUP BY name HAVING COUNT(*) > 1) d');
      return (r.rows[0] as { n: number }).n === 0;
    },
  },
  /** Resposta saudável de cada API externa que as rotas sensíveis chamam. */
  apis: {
    // nenhuma API externa nas rotas sensíveis
  },
  /** Uma requisição válida por rota sensível (o id é o da topologia). */
  requests: {
    'DELETE /categories/:id': { path: '/categories/1' }, // TODO(shieldepy): confira o parâmetro (routes/categoryRoute.js:7)
    'DELETE /products/:id': { path: '/products/1' }, // TODO(shieldepy): confira o parâmetro (routes/productRoute.js:9)
    'GET /categories': { path: '/categories' }, // pronta (routes/categoryRoute.js:4)
    'GET /products': { path: '/products' }, // pronta (routes/productRoute.js:4)
    'GET /products/:id': { path: '/products/1' }, // TODO(shieldepy): confira o parâmetro (routes/productRoute.js:5)
    'GET /products/category/:categoryId': { path: '/products/category/1' }, // TODO(shieldepy): confira o parâmetro (routes/productRoute.js:6)
    'POST /categories': { path: '/categories', body: { name: 'Revistas' } }, // TODO(shieldepy): um corpo válido (routes/categoryRoute.js:5)
    'POST /products': { path: '/products', body: { name: 'Caneta', price: 2, category_id: 1 } }, // TODO(shieldepy): um corpo válido (routes/productRoute.js:7)
    'PUT /categories/:id': { path: '/categories/1', body: { name: 'Gibis' } }, // TODO(shieldepy): um corpo válido (routes/categoryRoute.js:6)
    'PUT /products/:id': { path: '/products/1', body: { name: 'Livro 2', price: 12, category_id: 1 } }, // TODO(shieldepy): um corpo válido (routes/productRoute.js:8)
  },
};
