import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@mapedit/protocol': fileURLToPath(
        new URL('./packages/protocol/src/index.ts', import.meta.url),
      ),
      '@mapedit/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@mapedit/server': fileURLToPath(new URL('./packages/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 4,
  },
});
