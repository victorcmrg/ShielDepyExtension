import { fileURLToPath } from 'node:url';

/**
 * Pasta `wasm/` deste pacote, pra CLI/web/testes (ESM). A extensão NÃO importa isto — no bundle
 * CJS do esbuild `import.meta.url` não existe; lá o caminho vem de `context.extensionPath`.
 */
export function defaultWasmDir(): string {
  return fileURLToPath(new URL('../wasm', import.meta.url));
}
