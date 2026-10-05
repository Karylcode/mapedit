import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer as createVite, type ViteDevServer } from 'vite';
import { createServer, type MapeditServer } from '@mapedit/server';
import { forwardedOrigin } from '../dev-proxy.js';

const webRoot = fileURLToPath(new URL('..', import.meta.url));

/** Status of a WebSocket upgrade or a plain request, as the browser would send it. */
function send(
  port: number,
  path: string,
  {
    method = 'GET',
    origin,
    upgrade = false,
    host = `127.0.0.1:${port}`,
  }: { method?: string; origin?: string; upgrade?: boolean; host?: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: host };
    if (origin) headers.Origin = origin;
    if (upgrade)
      Object.assign(headers, {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      });
    const body = method === 'POST' ? JSON.stringify({ notice: 'agent_changed' }) : undefined;
    if (body) headers['Content-Type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, path, method, headers });
    req.on('upgrade', (response, socket) => {
      socket.destroy();
      resolve(response.statusCode ?? 0);
    });
    req.on('response', (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('forwardedOrigin', () => {
  const backend = 'http://127.0.0.1:4790';

  it('presents the page this dev server serves as the backend', () => {
    expect(forwardedOrigin('http://127.0.0.1:5173', '127.0.0.1:5173', backend, 5173)).toBe(backend);
    expect(forwardedOrigin('http://localhost:5174', 'localhost:5174', backend, 5174)).toBe(backend);
    expect(forwardedOrigin('http://[::1]:5173', '[::1]:5173', backend, 5173)).toBe(backend);
  });

  it('trusts only loopback names on its own port, whatever DNS says (FE25)', () => {
    // DNS rebinding: an attacker's name resolving to 127.0.0.1, so Origin and Host agree.
    expect(
      forwardedOrigin('http://rebind.example:5173', 'rebind.example:5173', backend, 5173),
    ).toBe('http://rebind.example:5173');
    expect(forwardedOrigin('http://127.0.0.1:5174', '127.0.0.1:5174', backend, 5173)).toBe(
      'http://127.0.0.1:5174',
    );
  });

  it('keeps every other origin, and adds none', () => {
    expect(forwardedOrigin('http://evil.example', '127.0.0.1:5173', backend, 5173)).toBe(
      'http://evil.example',
    );
    expect(forwardedOrigin('http://127.0.0.1:9999', '127.0.0.1:5173', backend, 5173)).toBe(
      'http://127.0.0.1:9999',
    );
    expect(forwardedOrigin(undefined, '127.0.0.1:5173', backend, 5173)).toBeUndefined();
  });
});

describe('the Vite dev server proxy (W0, FE4)', () => {
  let backend: MapeditServer;
  let vite: ViteDevServer;
  let port: number;

  beforeAll(async () => {
    backend = await createServer({ mock: true, port: 0 });
    process.env.MAPEDIT_BACKEND = backend.url;
    vite = await createVite({
      root: webRoot,
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      logLevel: 'silent',
      server: { port: 0, strictPort: false },
    });
    await vite.listen();
    port = (vite.httpServer!.address() as AddressInfo).port;
  }, 60_000);

  afterAll(async () => {
    await vite?.close();
    await backend?.close();
    delete process.env.MAPEDIT_BACKEND;
  });

  it('forwards requests from the editor page it serves to the backend', async () => {
    const own = `http://127.0.0.1:${port}`;
    expect(await send(port, '/ws', { origin: own, upgrade: true })).toBe(101);
    expect(await send(port, '/ws', { upgrade: true })).toBe(101);
    expect(await send(port, '/api/project', {})).toBe(200);
    expect(await send(port, '/api/mock/trigger', { method: 'POST', origin: own })).toBe(200);
  });

  it('lets the backend refuse other websites', async () => {
    const other = 'http://evil.example';
    expect(await send(port, '/ws', { origin: other, upgrade: true })).toBe(403);
    expect(await send(port, '/api/mock/trigger', { method: 'POST', origin: other })).toBe(403);
    expect(await send(port, '/api/project', { origin: other })).toBe(403);
  });

  it('lets the backend refuse a page that reaches it through DNS rebinding (FE25)', async () => {
    const host = `rebind.example:${port}`;
    const origin = `http://${host}`;
    expect(await send(port, '/ws', { host, origin, upgrade: true })).toBe(403);
    expect(await send(port, '/api/mock/trigger', { method: 'POST', host, origin })).toBe(403);
  });
});
