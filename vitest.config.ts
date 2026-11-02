import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    pool: 'forks',
    // sem teto, são ~15 forks: a RAM (16 GB, dividida com a GPU integrada) chega ao limite e o driver de vídeo cai (tela azul 0x10E)
    // o mínimo também: o padrão dele é o número de núcleos, e o Vitest 2 recusa mínimo maior que o máximo
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
    testTimeout: 20000,
  },
});
