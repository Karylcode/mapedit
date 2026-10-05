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
    // The browser tests share one production build of packages/web per run.
    globalSetup: ['packages/web/test/browser/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Performance acceptance should not compete with the million-tile mesh test
    // and several browser processes on a shared, small CI runner.
    maxWorkers: process.env.CI ? 1 : 4,
  },
});
