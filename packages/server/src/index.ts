import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, Edit, ServerMessage } from '@mapedit/protocol';
import { boxGlb } from './mock.js';
import { MemoryState, type StateStore } from './state.js';
export { MemoryState } from './state.js';
export { mockScene } from './mock.js';
export type { StateStore } from './state.js';

export interface ServerOptions {
  port?: number;
  mock?: boolean;
  root?: string;
  webRoot?: string;
  state?: StateStore;
}
export interface MapeditServer {
  url: string;
  port: number;
  state: StateStore;
  close(): Promise<void>;
}

function validEdit(value: unknown): value is Edit {
  if (!value || typeof value !== 'object') return false;
  const edit = value as Record<string, unknown>;
  return (
    typeof edit.ref === 'string' &&
    (edit.kind === 'delete' ||
      (edit.kind === 'move' &&
        typeof edit.rotation === 'number' &&
        Number.isFinite(edit.rotation) &&
        Array.isArray(edit.position) &&
        edit.position.length === 3 &&
        edit.position.every((n) => typeof n === 'number' && Number.isFinite(n))))
  );
}
function validMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'hello':
      return message.protocolVersion === 1 && ['editor', 'render'].includes(String(message.client));
    case 'openMap':
      return typeof message.mapId === 'string';
    case 'previewEdit':
      return Number.isSafeInteger(message.requestId) && validEdit(message.edit);
    case 'applyEdit':
      return (
        Number.isSafeInteger(message.requestId) &&
        Number.isSafeInteger(message.baseRevision) &&
        validEdit(message.edit)
      );
    case 'undo':
    case 'redo':
      return Number.isSafeInteger(message.requestId);
    default:
      return false;
  }
}
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

export async function createServer(options: ServerOptions = {}): Promise<MapeditServer> {
  const state = options.state ?? new MemoryState();
  let port = 0;
  const validRequest = (request: IncomingMessage): boolean => {
    const host = request.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
    return request.headers.origin === undefined || request.headers.origin === `http://${host}`;
  };
  const server = createHttpServer((request, response) => {
    void (async () => {
      if (!validRequest(request))
        return json(response, 403, { error: 'Host or Origin is not allowed.' });
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      await state.flush();
      if (url.pathname === '/api/project') return json(response, 200, state.project);
      if (url.pathname === '/api/scene') {
        const id = url.searchParams.get('map');
        if (id) await state.openMap(id);
        return json(response, 200, state.scene);
      }
      if (url.pathname.startsWith('/assets/mock/')) {
        if (
          url.pathname !== '/assets/mock/block.glb' &&
          url.pathname !== '/assets/mock/terrain.glb'
        )
          return json(response, 404, { error: 'Asset not found.' });
        response.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        response.end(
          url.pathname.endsWith('terrain.glb') ? boxGlb([100, 0.5, 100], [0, -0.5, 0]) : boxGlb(),
        );
        return;
      }
      if (url.pathname === '/mcp')
        return json(response, 501, { error: 'MCP will be available in milestone M5.' });
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/'))
        return json(response, 404, { error: 'Not found.' });
      if (options.webRoot) {
        const root = resolve(options.webRoot);
        const target = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (target !== root && !target.startsWith(root + sep))
          return json(response, 403, { error: 'Path is outside the web directory.' });
        const file = await stat(target)
          .then((s) => (s.isFile() ? target : resolve(root, 'index.html')))
          .catch(() => resolve(root, 'index.html'));
        const data = await readFile(file);
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
        };
        response.writeHead(200, {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        });
        response.end(data);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><title>Mapedit backend</title><p>Mapedit backend is running. Build packages/web to use the editor.</p>',
      );
    })().catch((error) =>
      json(response, 400, { error: error instanceof Error ? error.message : String(error) }),
    );
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on('upgrade', (request, socket, head) => {
    if (!validRequest(request) || request.url !== '/ws') {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
  });
  const opened = new Set<WebSocket>();
  const send = (client: WebSocket, message: ServerMessage): void => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage): void => {
    for (const client of opened) send(client, message);
  };
  state.on('message', broadcast);
  let queue = Promise.resolve();
  sockets.on('connection', (client) => {
    let welcomed = false;
    client.on('close', () => opened.delete(client));
    client.on('message', (data) => {
      queue = queue
        .then(async () => {
          const value: unknown = JSON.parse(data.toString());
          if (!validMessage(value)) {
            client.close(1008, 'Invalid protocol message.');
            return;
          }
          const message = value;
          if (message.type === 'hello') {
            welcomed = true;
            send(client, { type: 'welcome', protocolVersion: 1, project: state.project });
            return;
          }
          if (!welcomed) {
            client.close(1008, 'Send hello first.');
            return;
          }
          await state.flush();
          if (message.type === 'openMap') {
            await state.openMap(message.mapId);
            opened.add(client);
            send(client, { type: 'scene', scene: state.scene });
            send(client, { type: 'history', entries: state.entries, cursor: state.cursor });
            return;
          }
          if (!opened.has(client)) {
            client.close(1008, 'Open a map first.');
            return;
          }
          if (message.type === 'previewEdit') {
            send(client, await state.preview(message.edit, message.requestId));
            return;
          }
          const reason =
            message.type === 'applyEdit'
              ? await state.apply(message.edit, message.baseRevision)
              : await state.travel(message.type === 'undo' ? -1 : 1);
          send(client, {
            type: 'editResult',
            requestId: message.requestId,
            ok: reason === undefined,
            ...(reason ? { reason } : {}),
          });
          if (!reason) {
            broadcast({ type: 'scene', scene: state.scene });
            broadcast({ type: 'history', entries: state.entries, cursor: state.cursor });
          }
        })
        .catch((error) =>
          send(client, {
            type: 'notice',
            level: 'error',
            code: 'file_error',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    });
  });
  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4790, '127.0.0.1', () => {
      server.off('error', reject);
      resolveListening();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to bind local server.');
  port = address.port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    state,
    async close() {
      await queue;
      await state.close();
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolveClose) => sockets.close(() => resolveClose()));
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}

export { readProject, readProjectTexts, projectPath } from './project-files.js';

export { buildProject, buildFromParsed } from './build-project.js';
