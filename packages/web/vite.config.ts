import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { backendProxy } from './dev-proxy.js';

/** The editor server started by `mapedit dev`; override with MAPEDIT_BACKEND. */
const backend = process.env.MAPEDIT_BACKEND ?? 'http://127.0.0.1:4790';

export default defineConfig({
  resolve: {
    alias: {
      '@mapedit/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': backendProxy(backend),
      '/assets': backendProxy(backend),
      '/ws': backendProxy(backend, true),
    },
  },
  build: {
    outDir: 'dist',
    // `/assets/` belongs to the backend's generated GLB files.
    assetsDir: 'static',
    // The backend serves only .html, .js, .css, .png and .svg.
    assetsInlineLimit: 0,
    target: 'es2022',
    chunkSizeWarningLimit: 1024,
  },
});
