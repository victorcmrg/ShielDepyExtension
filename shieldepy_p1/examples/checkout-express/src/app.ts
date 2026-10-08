import express from 'express';
import { checkoutRouter } from './routes/checkout';

/** Usado pelo servidor e pelos testes de caos (supertest monta o app sem abrir porta). */
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(checkoutRouter);
  return app;
}
