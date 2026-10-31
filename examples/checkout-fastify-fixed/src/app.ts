import Fastify from 'fastify';
import { checkoutRoutes } from './routes/checkout';

/** Usado pelo servidor (server.ts) e pelos testes de caos (o supertest fala com o app sem abrir porta). */
export function buildApp() {
  const app = Fastify();
  app.register(checkoutRoutes, { prefix: '/api' });
  return app;
}
