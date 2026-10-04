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

const baseFiles: Record<string, string> = {
  'project.yaml': 'name: Failures\n',
  'modules/block/module.yaml': 'size: [2, 2, 2]\n',
  'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
  'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
  'maps/village/structures/a.yaml':
    'structures:\n  - id: a\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
};

async function project(extra: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-failures-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...baseFiles, ...extra })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  return { root, server };
}

async function connect(server: MapeditServer) {
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  cleanup.push(async () => socket.terminate());
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const next = async <T extends ServerMessage['type']>(type: T, requestId?: number) => {
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
  return { send, next };
}

const move = { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 };

describe('F28 edits blocked by file errors report file_errors', () => {
  for (const [label, extra] of [
    [
      'a YAML syntax error in another structure file',
      { 'maps/village/structures/b.yaml': 'structures: [\n' },
    ],
    ['a broken module.yaml', { 'modules/other/module.yaml': 'size: [2, 2\n' }],
    ['a failing model.ts', { 'modules/block/model.ts': 'export default nonsense(;' }],
    ['a syntax error in another map', { 'maps/other/map.yaml': 'size: {x: 100\n' }],
  ] as const)
    it(`previews and applies with ${label}`, async () => {
      const { root, server } = await project(extra);
      const before = await readFile(join(root, 'maps/village/structures/a.yaml'), 'utf8');
      const client = await connect(server);
      client.send({ type: 'previewEdit', requestId: 1, edit: move });
      const preview = await client.next('previewResult', 1);
      expect(preview).toMatchObject({ ok: false, failure: 'file_errors', violations: [] });
      client.send({ type: 'applyEdit', requestId: 2, baseRevision: 0, edit: move });
      const result = await client.next('editResult', 2);
      expect(result).toMatchObject({ ok: false, failure: 'file_errors' });
      expect(result.reason).toEqual(expect.any(String));
      expect(await readFile(join(root, 'maps/village/structures/a.yaml'), 'utf8')).toBe(before);
    });

  it('keeps immovable_object for a Module or an attached Structure', async () => {
    const { server } = await project({
      'modules/block/module.yaml':
        'size: [2, 2, 2]\nsockets:\n  - {id: east, type: wall, position: [2, 1, 1], direction: east}\n  - {id: west, type: wall, position: [0, 1, 1], direction: west}\n',
      'maps/village/structures/b.yaml':
        'structures:\n  - id: b\n    attach: {socket: base.west, to: a/base.east}\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
    });
    const client = await connect(server);
    for (const [requestId, ref] of [
      [1, 'module:a/base'],
      [2, 'structure:b'],
    ] as const) {
      client.send({ type: 'previewEdit', requestId, edit: { ...move, ref } });
      const preview = await client.next('previewResult', requestId);
      expect(preview).toMatchObject({ ok: false, failure: 'immovable_object' });
      expect(preview.violations[0]).toMatchObject({
        kind: 'missing_reference',
        params: { reason: 'immovable_object' },
      });
    }
    client.send({ type: 'previewEdit', requestId: 3, edit: { ...move, ref: 'structure:gone' } });
    expect(await client.next('previewResult', 3)).toMatchObject({ failure: 'unknown_object' });
    client.send({
      type: 'previewEdit',
      requestId: 4,
      edit: { ...move, position: [99, 0, 10] },
    });
    expect(await client.next('previewResult', 4)).toMatchObject({
      ok: false,
      failure: 'violations',
    });
  });
});
