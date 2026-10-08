import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // o mesmo alias `@/*` do tsconfig
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['chaos/**/*.test.ts'],
    setupFiles: ['chaos/setup.ts'],
  },
});
