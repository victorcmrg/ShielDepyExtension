import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app';

const PORT = Number(process.env.PORT) || 3001;
const log = (m: string) => console.error(m);

// O site é o build do Vite (React). Em dev quem serve as páginas é o Vite (npm run dev), com proxy pra cá.
// A API serve o build do front (apps/web/dist); SHIELDEPY_STATIC_DIR troca a pasta.
const staticDir = process.env.SHIELDEPY_STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
if (!existsSync(join(staticDir, 'index.html'))) {
  log(`[web] build do site não encontrado (${staticDir}): rode \`npm run build -w @shieldepy/web\`, ou \`npm run web:dev\` para desenvolver.`);
}

// Abre o banco e aplica as migrations antes de ouvir: banco fora do ar derruba na subida, não na
// primeira requisição. O app.ts reaproveita este mesmo módulo.
const { database } = await import('./composition');
log(`[web] banco: ${database.kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'PGlite local'}`);

const handler = createHandler({ staticDir, log });
const server = createServer((req, res) => void handler(req, res)).listen(PORT, () => {
  console.log(`🛡️  ShielDepy web no ar: http://localhost:${PORT}`);
});

// O PGlite grava no disco ao fechar: Ctrl+C e o encerramento do deploy fecham o banco antes de sair.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close();
    void database.close().finally(() => process.exit(0));
  });
}
