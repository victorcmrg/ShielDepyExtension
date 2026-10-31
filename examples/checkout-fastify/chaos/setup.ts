// Gerado pelo `shieldepy chaos --init`: carregado antes de cada teste de caos. O `pg` vira o banco de chaos/db.ts.
// Nada no código do app muda. Pode editar (o --init não sobrescreve).
import { createRequire } from 'node:module';
import { vi } from 'vitest';
import { Client, Pool } from './db';

// require() (CommonJS): o vi.mock não alcança o require nativo; a troca é no módulo em cache, antes de o app carregar
const nodeRequire = createRequire(import.meta.url);

// --- o banco: o `pg` do app vira o PGlite de chaos/db.ts
vi.mock('pg', async () => {
  const db = await import('./db');
  return { Pool: db.Pool, Client: db.Client, default: { Pool: db.Pool, Client: db.Client } };
});

const pg = nodeRequire('pg');
pg.Pool = Pool;
pg.Client = Client;
