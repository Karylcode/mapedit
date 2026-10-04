import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ServerMessage } from '@mapedit/protocol';
import { createServer, type MapeditServer } from '../src/index.js';
import type { DiskState } from '../src/disk-state.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const files: Record<string, string> = {
  'project.yaml': 'name: Replies\n',
  'modules/block/module.yaml': 'size: [2, 2, 2]\n',
  'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
  'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
  'maps/village/structures/a.yaml':
    'structures:\n  - id: a\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
};

async function realServer(options: { mock?: boolean } = {}) {
  if (options.mock) {
    const server = await createServer({ mock: true, port: 0 });
    cleanup.push(() => server.close());
    return server;
  }
  const root = await mkdtemp(join(tmpdir(), 'mapedit-replies-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  return server;
}

async function connect(server: MapeditServer) {
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  cleanup.push(async () => socket.terminate());
  const messages: ServerMessage[] = [];
  const received: ServerMessage[] = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as ServerMessage;
    messages.push(message);
    received.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const next = async <T extends ServerMessage['type']>(
    type: T,
    filter: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ) => {
    const matches = (message: ServerMessage) =>
      message.type === type && filter(message as Extract<ServerMessage, { type: T }>);
    await expect.poll(() => messages.some(matches)).toBe(true);
    return messages.splice(messages.findIndex(matches), 1)[0] as Extract<
      ServerMessage,
      { type: T }
    >;
  };
  const reply = <T extends 'previewResult' | 'editResult'>(type: T, requestId: number) =>
    next(type, (message) => message.requestId === requestId);
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  await next('welcome');
  return { send, next, reply, received };
}

const move = { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 };

describe('F30 every request gets an answer', () => {
  it('answers previews, edits, undo and redo with internal_error when the state fails', async () => {
    const server = await realServer();
    const state = server.state as DiskState;
    const client = await connect(server);
    client.send({ type: 'openMap', mapId: 'village' });
    await client.next('scene');
    const busy = new Error('EBUSY: resource busy or locked, open maps/village/map.yaml');
    const getBuild = vi.spyOn(state, 'getBuild').mockRejectedValue(busy);
    client.send({ type: 'previewEdit', requestId: 1, edit: move });
    expect(await client.reply('previewResult', 1)).toEqual({
      type: 'previewResult',
      requestId: 1,
      ok: false,
      violations: [],
      failure: 'internal_error',
    });
    client.send({ type: 'applyEdit', requestId: 2, baseRevision: 0, edit: move });
    expect(await client.reply('editResult', 2)).toEqual({
      type: 'editResult',
      requestId: 2,
      ok: false,
      reason: busy.message,
      failure: 'internal_error',
    });
    getBuild.mockRestore();
    const flush = vi.spyOn(state, 'flush').mockRejectedValue(busy);
    for (const [requestId, type] of [
      [3, 'undo'],
      [4, 'redo'],
    ] as const) {
      client.send({ type, requestId });
      expect(await client.reply('editResult', requestId)).toMatchObject({
        ok: false,
        failure: 'internal_error',
        reason: busy.message,
      });
    }
    flush.mockRestore();
    // A request that succeeds afterwards proves the queue still runs and settles earlier replies.
    client.send({ type: 'previewEdit', requestId: 5, edit: move });
    expect(await client.reply('previewResult', 5)).toMatchObject({ ok: true });
    const answers = client.received.filter(
      (message) => message.type === 'previewResult' || message.type === 'editResult',
    );
    expect(answers.map((message) => 'requestId' in message && message.requestId)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(state.entries).toEqual([]);
  });
});

describe('F30 unknown maps are never built or cached', () => {
  it('answers openMap for an unknown map with unknown_map and keeps the open map', async () => {
    const server = await realServer();
    const state = server.state as DiskState;
    const client = await connect(server);
    client.send({ type: 'openMap', mapId: 'nowhere' });
    const notice = await client.next('notice');
    expect(notice).toEqual({
      type: 'notice',
      level: 'error',
      code: 'unknown_map',
      message: 'Map "nowhere" does not exist. Choose a map listed in project information.',
    });
    expect(client.received.some((message) => message.type === 'scene')).toBe(false);
    expect(state.builds.has('nowhere')).toBe(false);
    client.send({ type: 'openMap', mapId: 'village' });
    await client.next('scene');
    client.send({ type: 'openMap', mapId: 'nowhere' });
    await client.next('notice', (message) => message.code === 'unknown_map');
    client.send({ type: 'previewEdit', requestId: 1, edit: move });
    expect(await client.reply('previewResult', 1)).toMatchObject({ ok: true });
    expect(state.builds.has('nowhere')).toBe(false);
    expect([...state.builds.keys()]).toEqual(['village']);
  });

  it('answers HTTP and MCP requests for an unknown map without caching it', async () => {
    const server = await realServer();
    const state = server.state as DiskState;
    const response = await fetch(`${server.url}/api/scene?map=nowhere`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Map "nowhere" does not exist. Choose a map listed in project information.',
    });
    const mcp = new Client({ name: 'replies-test', version: '1' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => mcp.close());
    for (const name of ['overview', 'check', 'query'] as const) {
      const result = (await mcp.callTool({
        name,
        arguments: name === 'query' ? { map: 'nowhere', x: 1, z: 1 } : { map: 'nowhere' },
      })) as CallToolResult;
      expect(result.isError, name).toBe(true);
      expect((result.content[0] as { text: string }).text, name).toContain(
        'Map "nowhere" does not exist.',
      );
    }
    expect([...state.builds.keys()]).toEqual(['village']);
  });

  it('answers an unknown map the same way in mock mode', async () => {
    const server = await realServer({ mock: true });
    const client = await connect(server);
    client.send({ type: 'openMap', mapId: 'nowhere' });
    expect(await client.next('notice')).toMatchObject({ level: 'error', code: 'unknown_map' });
    expect((await fetch(`${server.url}/api/scene?map=nowhere`)).status).toBe(404);
  });
});
