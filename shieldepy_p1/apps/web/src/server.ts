import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { TsParser } from '@shieldepy/core';
import { defaultWasmDir } from '@shieldepy/core/wasm-path';
import { createRegistry } from '@shieldepy/extractors';
import { providerFromEnv } from '@shieldepy/agent';
import { createHandler } from './app';

const PORT = Number(process.env.PORT) || 3000;
const log = (m: string) => console.error(m);

let registry;
try {
  registry = createRegistry({ tsParser: await TsParser.load(defaultWasmDir()) });
} catch (err) {
  log(`[web] Tree-sitter indisponível (${err}); TS/JS via regex.`);
  registry = createRegistry();
}
const provider = providerFromEnv(process.env, log);

const handler = createHandler({
  registry,
  provider,
  publicDir: fileURLToPath(new URL('../public', import.meta.url)),
  examplesDir: fileURLToPath(new URL('../../../examples', import.meta.url)),
  log,
});

createServer((req, res) => void handler(req, res)).listen(PORT, () => {
  const modo = provider ? `IA ligada (${provider.name})` : 'modo offline (sem ANTHROPIC_API_KEY / GEMINI_API_KEY)';
  console.log(`🛡️  ShielDepy web no ar: http://localhost:${PORT}  —  ${modo}`);
});
