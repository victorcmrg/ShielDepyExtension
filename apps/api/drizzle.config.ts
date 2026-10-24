// drizzle-kit: `npm run db:generate -w @shieldepy/api` compara o esquema com as migrations e gera a
// próxima em ./drizzle (decisão 0015). A API aplica as pendentes ao subir (src/shared/db/postgres.ts).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/shared/db/schema.ts',
  out: './drizzle',
});
