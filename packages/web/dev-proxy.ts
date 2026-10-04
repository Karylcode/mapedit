import type { IncomingMessage } from 'node:http';
import type { ProxyOptions } from 'vite';

/**
 * The Origin to send on to the backend. The backend accepts only its own
 * origin, so a request from the page this dev server serves (its Origin is
 * the dev server's own host) is presented as the backend's own. Any other
 * website keeps its Origin, and the backend refuses it.
 */
export function forwardedOrigin(
  origin: string | undefined,
  host: string | undefined,
  backend: string,
): string | undefined {
  if (origin === undefined) return undefined;
  return host !== undefined && origin === `http://${host}` ? backend : origin;
}

interface OutgoingHeaders {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Proxy `/api`, `/assets` and `/ws` to the editor server started by `mapedit dev`. */
export function backendProxy(backend: string, ws = false): ProxyOptions {
  const rewrite = (outgoing: OutgoingHeaders, incoming: IncomingMessage) => {
    const origin = outgoing.getHeader('origin');
    const current = typeof origin === 'string' ? origin : undefined;
    const next = forwardedOrigin(current, incoming.headers.host, backend);
    if (next !== undefined && next !== current) outgoing.setHeader('origin', next);
  };
  return {
    target: backend,
    // The backend also checks Host, so requests carry the backend's host.
    changeOrigin: true,
    ws,
    configure(proxy) {
      proxy.on('proxyReq', (request, incoming) => rewrite(request, incoming));
      proxy.on('proxyReqWs', (request, incoming) => rewrite(request, incoming));
    },
  };
}
