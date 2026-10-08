// Carregado antes de cada arquivo de teste (vitest `setupFiles`): o `pg` que o app importa vira o
// banco em memória. É a única ponte entre o app e os testes de caos — nada no `src/` sabe disso.
import { vi } from 'vitest';

vi.mock('pg', async () => {
  const { Pool } = await import('./db');
  return { Pool, default: { Pool } };
});
