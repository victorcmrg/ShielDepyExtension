import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { loadRegistry } from '@shieldepy/extractors';
import { providerFromEnv } from '@shieldepy/agent';
import { createHandler } from './app';

const PORT = Number(process.env.PORT) || 3001;
const log = (m: string) => console.error(m);

const registry = await loadRegistry(defaultWasmDir());
if (registry.failed.length > 0) log(`[web] gramáticas indisponíveis (linguagens ignoradas): ${registry.failed.join(', ')}`);
const provider = providerFromEnv(process.env, log);

// O site é o build do Vite (React). Em dev quem serve as páginas é o Vite (npm run dev), com proxy pra cá.
const staticDir = fileURLToPath(new URL('../dist', import.meta.url));
if (!existsSync(join(staticDir, 'index.html'))) {
  log('[web] build do site não encontrado (apps/frontend/dist): rode `npm run build -w @shieldepy/frontend`, ou `npm run dev -w @shieldepy/frontend` para desenvolver.');
}

const handler = createHandler({
  registry,
  provider,
  staticDir,
  examplesDir: fileURLToPath(new URL('../../../examples', import.meta.url)),
  log,
});

createServer((req, res) => void handler(req, res)).listen(PORT, () => {
  const modo = provider ? `IA ligada (${provider.name})` : 'modo offline (sem ANTHROPIC_API_KEY / GEMINI_API_KEY)';
  console.log(`🛡️  ShielDepy web no ar: http://localhost:${PORT}  —  ${modo}`);
});
