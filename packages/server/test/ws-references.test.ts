import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@mapedit/protocol';
import { createServer, type MapeditServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function realServer(): Promise<{ server: MapeditServer; house: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-ws-refs-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: References\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/house.yaml':
      'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
    'maps/village/markers.yaml':
      'markers:\n  - {id: spawn, type: spawn, shape: {kind: point, position: [5, 0, 5]}}\n',
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  return { server, house: join(root, 'maps/village/structures/house.yaml') };
}
async function mockServer(): Promise<{ server: MapeditServer }> {
  const server = await createServer({ port: 0, mock: true });
  cleanup.push(() => server.close());
  return { server };
}

async function connect(server: MapeditServer) {
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  cleanup.push(async () => socket.terminate());
  const messages: ServerMessage[] = [];
  let closed: number | undefined;
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  socket.on('close', (code) => (closed = code));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const next = async <T extends ServerMessage['type']>(
    type: T,
    requestId?: number,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const matches = (message: ServerMessage) =>
      message.type === type &&
      (requestId === undefined || ('requestId' in message && message.requestId === requestId));
    await expect.poll(() => messages.some(matches)).toBe(true);
    return messages.splice(messages.findIndex(matches), 1)[0] as Extract<
      ServerMessage,
      { type: T }
    >;
  };
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  await next('welcome');
  send({ type: 'openMap', mapId: 'village' });
  await next('scene');
  await next('history');
  return { socket, send, next, messages, closed: () => closed };
}

const staleRefs = [
  'not-a-ref',
  'structure:house/extra',
  'module:house/base.east',
  'structure:ghost',
  'module:house/ghost',
  'marker:ghost',
];

describe.each([
  ['mock', mockServer],
  ['real', realServer],
] as const)('F21 stale references over WebSocket (%s server)', (_name, start) => {
  it('answers previews and edits for malformed or missing refs without disconnecting', async () => {
    const { server } = await start();
    const client = await connect(server);
    const revision = (await server.state.getScene()).revision;
    let requestId = 0;
    for (const ref of staleRefs)
      for (const edit of [
        { kind: 'move', ref, position: [20, 0, 20], rotation: 0 },
        { kind: 'delete', ref },
      ]) {
        const previewId = ++requestId;
        client.send({ type: 'previewEdit', requestId: previewId, edit });
        const preview = await client.next('previewResult', previewId);
        expect(preview.ok, `${edit.kind} ${ref}`).toBe(false);
        expect(preview.violations).toHaveLength(1);
        expect(preview.violations[0]).toMatchObject({ kind: 'missing_reference', refs: [ref] });

        const applyId = ++requestId;
        client.send({ type: 'applyEdit', requestId: applyId, baseRevision: revision, edit });
        const result = await client.next('editResult', applyId);
        expect(result.ok, `${edit.kind} ${ref}`).toBe(false);
        expect(result.reason).toEqual(expect.any(String));
        expect((await client.next('notice')).code).toBe('edit_rejected');
      }
    expect(client.closed()).toBeUndefined();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(server.state.entries).toEqual([]);
    expect((await server.state.getScene()).revision).toBe(revision);

    // The same connection still serves valid requests.
    client.send({
      type: 'previewEdit',
      requestId: ++requestId,
      edit: { kind: 'move', ref: 'structure:house', position: [20, 0, 20], rotation: 0 },
    });
    expect((await client.next('previewResult', requestId)).ok).toBe(true);
  });

  it('closes with 1008 only for structurally invalid messages', async () => {
    const { server } = await start();
    for (const raw of [
      '{not json',
      JSON.stringify({ type: 'previewEdit', requestId: 1, edit: { kind: 'delete', ref: 42 } }),
      JSON.stringify({
        type: 'applyEdit',
        requestId: 1,
        baseRevision: 0,
        edit: { kind: 'move', ref: 'structure:house', position: [1, 2], rotation: 0 },
      }),
      JSON.stringify({ type: 'teleport', requestId: 1 }),
    ]) {
      const client = await connect(server);
      const closed = new Promise<number>((resolve) => client.socket.once('close', resolve));
      client.socket.send(raw);
      expect(await closed, raw).toBe(1008);
    }
    expect(server.state.entries).toEqual([]);
  });
});

it('F21 answers a ref that an Agent edit removed while the editor still holds it', async () => {
  const { server, house } = await realServer();
  const client = await connect(server);
  // An Agent renames the Structure; the editor still shows the old ref.
  await writeFile(house, (await readFile(house, 'utf8')).replace('id: house', 'id: home'));
  await server.state.flush();
  client.send({
    type: 'applyEdit',
    requestId: 7,
    baseRevision: 0,
    edit: { kind: 'move', ref: 'structure:house', position: [20, 0, 20], rotation: 0 },
  });
  const result = await client.next('editResult', 7);
  expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('structure:house') });
  expect(client.socket.readyState).toBe(WebSocket.OPEN);
});
