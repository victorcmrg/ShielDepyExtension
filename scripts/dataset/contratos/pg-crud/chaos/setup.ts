// Gerado pelo `shieldepy chaos --init`: carregado antes de cada teste de caos.
// - o `pg` que o app usa vira o banco de chaos/db.ts;
// - o `express` vira o de chaos/app.ts, que guarda o app e não abre porta;
// nada no código do app muda. No import (ESM e TypeScript), o Vitest troca o módulo; no require()
// (CommonJS), o vi.mock não alcança o require nativo, e a troca é no módulo em cache, antes de o app carregar.
import { createRequire } from 'node:module';
import { vi } from 'vitest';
import { express } from './app';
import { Client, Pool } from './db';

const required = createRequire(import.meta.url);

vi.mock('pg', async () => {
  const db = await import('./db');
  return { Pool: db.Pool, Client: db.Client, default: { Pool: db.Pool, Client: db.Client } };
});
const pg = required('pg');
pg.Pool = Pool;
pg.Client = Client;

vi.mock('express', async () => {
  const { express } = await import('./app');
  return { ...express, default: express };
});
required('express');
required.cache[required.resolve('express')]!.exports = express;
