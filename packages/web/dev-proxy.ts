import type { IncomingMessage } from 'node:http';
import type { ProxyOptions } from 'vite';

/** Names that always mean this machine; no DNS answer can point them elsewhere. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The Origin to send on to the backend. The backend accepts only its own
 * origin, so a request from the page this dev server serves is presented as
 * the backend's own: its Origin is this server's own address, a loopback name
 * on the port `devPort` it was received on. Any other website keeps its
 * Origin, and the backend refuses it. That includes a name an attacker points
 * at 127.0.0.1 (DNS rebinding), even though its Origin and Host then agree.
 */
export function forwardedOrigin(
  origin: string | undefined,
  host: string | undefined,
  backend: string,
  devPort: number | undefined,
): string | undefined {
  if (origin === undefined || host === undefined || origin !== `http://${host}`) return origin;
  let page: URL;
  try {
    page = new URL(origin);
  } catch {
    return origin;
  }
  const ours = LOOPBACK.has(page.hostname) && Number(page.port || 80) === devPort;
  return ours ? backend : origin;
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
    const next = forwardedOrigin(
      current,
      incoming.headers.host,
      backend,
      incoming.socket.localPort,
    );
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
