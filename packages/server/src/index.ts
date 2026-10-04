import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, Edit, ServerMessage } from '@mapedit/protocol';
import { mockAsset } from './mock.js';
import { MemoryState, type StateStore } from './state.js';
import { DiskState } from './disk-state.js';
import { buildProject, buildFromParsed } from './build-project.js';
import { ScreenshotService } from './screenshot.js';
import { createMcpHttpHandler, type AgentServices } from './mcp.js';
import { createAgentServices } from './services.js';
import { createMockServices, parseMockNotice, triggerMockNotice } from './mock-services.js';
export { MemoryState } from './state.js';
export { mockScene } from './mock.js';
export type { StateStore } from './state.js';
export { readProject, readProjectTexts, projectPath } from './project-files.js';
export { buildProject, buildProjects, buildFromParsed } from './build-project.js';
export { exportProject } from './export-project.js';
export { connectStdio } from './mcp.js';
export { DiskState } from './disk-state.js';

export interface ServerOptions {
  port?: number;
  mock?: boolean;
  root?: string;
  webRoot?: string;
  state?: StateStore;
  browserPath?: string;
  services?: AgentServices;
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

function readMockTrigger(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let exceeded = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 16_384) {
        if (!exceeded) reject(new RangeError('Mock trigger body exceeds 16384 bytes.'));
        exceeded = true;
        chunks.length = 0;
      } else chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (exceeded) return;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Mock trigger body must be valid JSON.'));
      }
    });
  });
}

export async function createServer(options: ServerOptions = {}): Promise<MapeditServer> {
  const root = resolve(options.root ?? process.cwd());
  const canonicalRoot = await realpath(root);
  const projectIdentity = createHash('sha256')
    .update(process.platform === 'win32' ? canonicalRoot.toLowerCase() : canonicalRoot)
    .digest('hex');
  const instanceIdentity = randomUUID();
  const state: StateStore =
    options.state ??
    (options.mock
      ? new MemoryState()
      : await DiskState.create(root, {
          build: (id, revision) => buildProject(root, id, revision),
          preview: buildFromParsed,
        }));
  const defaultWebRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
  const webRoot =
    options.webRoot ??
    (await stat(defaultWebRoot).then(
      (value) => (value.isDirectory() ? defaultWebRoot : undefined),
      () => undefined,
    ));
  const sceneFor = async (id?: string) => {
    if (state.getScene) return state.getScene(id);
    if (id) await state.openMap(id);
    return state.scene;
  };
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
      response.setHeader('X-Mapedit-Instance', instanceIdentity);
      response.setHeader('X-Mapedit-Project', projectIdentity);
      response.setHeader('X-Mapedit-Pid', String(process.pid));
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/api/mock/trigger') {
        if (!options.mock || !(state instanceof MemoryState))
          return json(response, 404, { error: 'Not found.' });
        if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
        try {
          const code = parseMockNotice(await readMockTrigger(request));
          const triggered = queue.then(() => triggerMockNotice(state, code));
          queue = triggered.catch(() => {});
          await triggered;
          return json(response, 200, { ok: true });
        } catch (error) {
          return json(response, error instanceof RangeError ? 413 : 400, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (request.method === 'HEAD' && url.pathname === '/api/project') {
        response.writeHead(200, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }
      if (url.pathname === '/mcp') {
        await mcp.handle(request, response);
        return;
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      if (url.pathname.startsWith('/api/')) await state.flush();
      if (url.pathname === '/api/project') return json(response, 200, state.project);
      if (url.pathname === '/api/scene') {
        const id = url.searchParams.get('map');
        return json(response, 200, await sceneFor(id ?? undefined));
      }
      if (url.pathname.startsWith('/assets/mock/')) {
        const data = options.mock ? mockAsset(url.pathname) : undefined;
        if (!data) return json(response, 404, { error: 'Asset not found.' });
        response.writeHead(200, { 'Content-Type': 'model/gltf-binary' });
        response.end(data);
        return;
      }
      if (url.pathname.startsWith('/assets/')) {
        const data = state.asset?.(url.pathname);
        if (data) {
          response.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          response.end(data);
          return;
        }
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/'))
        return json(response, 404, { error: 'Not found.' });
      if (webRoot) {
        const root = resolve(webRoot);
        const target = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (target !== root && !target.startsWith(root + sep))
          return json(response, 403, { error: 'Path is outside the web directory.' });
        const file = await stat(target)
          .then((s) => (s.isFile() ? target : resolve(root, 'index.html')))
          .catch(() => resolve(root, 'index.html'));
        const actualRoot = await realpath(root),
          actualFile = await realpath(file);
        if (!actualFile.startsWith(actualRoot + sep))
          return json(response, 403, { error: 'Path is outside the web directory.' });
        const data = await readFile(actualFile);
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
  const opened = new Map<WebSocket, string>();
  const send = (client: WebSocket, message: ServerMessage): void => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage): void => {
    for (const [client, mapId] of opened)
      if (message.type !== 'scene' || message.scene.map.id === mapId) send(client, message);
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
          // Drag frames use the latest compiled snapshot. The watcher refreshes it in the
          // background; commits and other requests still establish a disk-read barrier.
          if (message.type !== 'previewEdit') await state.flush();
          if (message.type === 'openMap') {
            const scene = await sceneFor(message.mapId);
            opened.set(client, message.mapId);
            send(client, { type: 'scene', scene });
            send(client, { type: 'history', entries: state.entries, cursor: state.cursor });
            return;
          }
          if (!opened.has(client)) {
            client.close(1008, 'Open a map first.');
            return;
          }
          if (message.type === 'previewEdit') {
            send(client, await state.preview(message.edit, message.requestId, opened.get(client)));
            return;
          }
          const reason =
            message.type === 'applyEdit'
              ? await state.apply(message.edit, message.baseRevision, opened.get(client))
              : await state.travel(message.type === 'undo' ? -1 : 1);
          send(client, {
            type: 'editResult',
            requestId: message.requestId,
            ok: reason === undefined,
            ...(reason ? { reason } : {}),
          });
          if (!reason) {
            for (const mapId of new Set(opened.values()))
              broadcast({ type: 'scene', scene: await sceneFor(mapId) });
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
  }).catch(async (error) => {
    await state.close();
    throw error;
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to bind local server.');
  port = address.port;
  const screenshots = new ScreenshotService(`http://127.0.0.1:${port}`, options.browserPath);
  const mcp = createMcpHttpHandler(
    options.services ??
      (state instanceof DiskState
        ? createAgentServices(state, screenshots)
        : createMockServices(state, screenshots)),
    screenshots,
  );
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    state,
    async close() {
      await queue;
      await mcp?.close();
      await screenshots?.close();
      await state.close();
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>((resolveClose) => sockets.close(() => resolveClose()));
      await new Promise<void>((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      );
    },
  };
}
