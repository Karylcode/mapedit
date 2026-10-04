import { defineConfig, type ProxyOptions } from 'vite';
import { fileURLToPath } from 'node:url';

/** The editor server started by `mapedit dev`; override with MAPEDIT_BACKEND. */
const backend = process.env.MAPEDIT_BACKEND ?? 'http://127.0.0.1:4790';

// The backend accepts only its own Host and Origin, so the proxy presents
// every request as if the page had been served by the backend itself.
const toBackend = (ws = false): ProxyOptions => ({
  target: backend,
  changeOrigin: true,
  ws,
  configure(proxy) {
    proxy.on('proxyReq', (request) => {
      if (request.getHeader('origin')) request.setHeader('origin', backend);
    });
    proxy.on('proxyReqWs', (request) => request.setHeader('origin', backend));
  },
});

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
      '/api': toBackend(),
      '/assets': toBackend(),
      '/ws': toBackend(true),
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
