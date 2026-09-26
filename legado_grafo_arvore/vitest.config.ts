import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    // O módulo `vscode` só existe dentro do Extension Host — nos testes ele é trocado por um
    // stub mínimo com o que o código de produção realmente usa.
    alias: { vscode: path.resolve(__dirname, 'test/mocks/vscode.ts') },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 20000,
  },
});
