import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { request } from 'node:http';
import type { ClientMessage, ServerMessage } from '@mapedit/protocol';
import { createServer, MemoryState, type MapeditServer } from '../src/index.js';

const servers: MapeditServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function setup() {
  const state = new MemoryState();
  const server = await createServer({ port: 0, mock: true, state });
  servers.push(server);
  const client = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  const messages: ServerMessage[] = [];
  client.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  const wait = async <T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    await expect.poll(() => messages.some((message) => message.type === type)).toBe(true);
    return messages.splice(
      messages.findIndex((message) => message.type === type),
      1,
    )[0] as Extract<ServerMessage, { type: T }>;
  };
  const send = (message: ClientMessage) => client.send(JSON.stringify(message));
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  await wait('welcome');
  send({ type: 'openMap', mapId: 'village' });
  await wait('scene');
  await wait('history');
  return { server, state, client, send, wait, messages };
}

describe('protocol version 1 mock contract', () => {
  it('serves project, scene, render fallback and valid GLB assets', async () => {
    const { server } = await setup();
    expect(await (await fetch(server.url + '/api/project')).json()).toMatchObject({
      name: 'Mock project',
    });
    const scene = await (await fetch(server.url + '/api/scene?map=village')).json();
    expect(scene).toMatchObject({ protocolVersion: 1, revision: 0 });
    expect((await fetch(server.url + '/render')).status).toBe(200);
    for (const path of ['/assets/mock/block.glb', '/assets/mock/terrain.glb']) {
      const glb = Buffer.from(await (await fetch(server.url + path)).arrayBuffer());
      expect(glb.readUInt32LE(0)).toBe(0x46546c67);
      expect(glb.readUInt32LE(8)).toBe(glb.length);
    }
    expect((await fetch(server.url + '/assets/missing.glb')).status).toBe(404);
  });
  it('previews snapping without mutation, applies, rejects invalid movement, deletes, undoes and redoes', async () => {
    const { state, send, wait } = await setup();
    const edit = {
      kind: 'move' as const,
      ref: 'structure:house',
      position: [15.2, 9, 12.8] as [number, number, number],
      rotation: 16,
    };
    send({ type: 'previewEdit', requestId: 1, edit });
    const preview = await wait('previewResult');
    expect(preview.ok).toBe(true);
    expect(preview.transform?.slice(12, 15)).toEqual([15, 0, 13]);
    expect(state.scene.revision).toBe(0);
    send({ type: 'applyEdit', requestId: 2, edit, baseRevision: 0 });
    expect((await wait('editResult')).ok).toBe(true);
    expect((await wait('scene')).scene.revision).toBe(1);
    expect((await wait('history')).cursor).toBe(1);
    send({
      type: 'applyEdit',
      requestId: 3,
      edit: { ...edit, position: [-10, 0, 0] },
      baseRevision: 1,
    });
    expect((await wait('editResult')).ok).toBe(false);
    expect((await wait('notice')).code).toBe('edit_rejected');
    send({
      type: 'applyEdit',
      requestId: 4,
      edit: { kind: 'delete', ref: 'module:house/base' },
      baseRevision: 1,
    });
    expect((await wait('editResult')).ok).toBe(true);
    expect((await wait('scene')).scene.structures[0]!.instances).toHaveLength(0);
    await wait('history');
    send({ type: 'undo', requestId: 5 });
    expect((await wait('editResult')).ok).toBe(true);
    expect((await wait('scene')).scene.structures[0]!.instances).toHaveLength(1);
    expect((await wait('history')).cursor).toBe(1);
    send({ type: 'redo', requestId: 6 });
    expect((await wait('editResult')).ok).toBe(true);
    expect((await wait('scene')).scene.structures[0]!.instances).toHaveLength(0);
    expect((await wait('history')).cursor).toBe(2);
  });
  it('moves and deletes markers and structures', async () => {
    const { send, wait } = await setup();
    send({
      type: 'applyEdit',
      requestId: 1,
      baseRevision: 0,
      edit: { kind: 'move', ref: 'marker:spawn', position: [8.1, 0, 4.8], rotation: 45 },
    });
    await wait('editResult');
    expect((await wait('scene')).scene.markers[0]!.shape).toMatchObject({
      position: [8, 0, 5],
      rotation: 45,
    });
    await wait('history');
    for (const ref of ['marker:spawn', 'structure:house']) {
      send({ type: 'applyEdit', requestId: 2, baseRevision: 0, edit: { kind: 'delete', ref } });
      expect((await wait('editResult')).ok).toBe(true);
      await wait('scene');
      await wait('history');
    }
  });
  it('sends every concurrency and file error notice, and includes Agent history in undo', async () => {
    const { state, send, wait } = await setup();
    const edit = {
      kind: 'move' as const,
      ref: 'structure:house',
      position: [12, 0, 12] as [number, number, number],
      rotation: 0,
    };
    send({ type: 'applyEdit', requestId: 1, baseRevision: 0, edit });
    await wait('editResult');
    await wait('scene');
    await wait('history');
    const scene = structuredClone(state.scene);
    scene.fileErrors = [{ file: 'broken.yaml', line: 2, message: 'Invalid YAML.' }];
    state.replaceFromAgent(scene, ['structure:house']);
    expect((await wait('notice')).code).toBe('agent_changed');
    expect((await wait('notice')).code).toBe('overwritten_by_agent');
    expect((await wait('notice')).code).toBe('file_error');
    await wait('scene');
    expect((await wait('history')).entries.at(-1)?.author).toBe('agent');
    send({ type: 'applyEdit', requestId: 2, baseRevision: 1, edit });
    expect((await wait('notice')).code).toBe('agent_change_overridden');
    await wait('editResult');
    await wait('scene');
    await wait('history');
    send({ type: 'undo', requestId: 3 });
    await wait('editResult');
    await wait('scene');
    await wait('history');
    send({ type: 'undo', requestId: 4 });
    await wait('editResult');
    expect((await wait('scene')).scene.fileErrors).toEqual([]);
  });
  it('rejects foreign Host and Origin over HTTP and WebSocket', async () => {
    const { server } = await setup();
    expect(
      (await fetch(server.url + '/api/project', { headers: { Origin: 'https://attacker.test' } }))
        .status,
    ).toBe(403);
    const status = await new Promise<number | undefined>((resolve) =>
      request(server.url, { headers: { host: 'attacker.test' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).end(),
    );
    expect(status).toBe(403);
    const client = new WebSocket(server.url.replace('http:', 'ws:') + '/ws', {
      origin: 'https://attacker.test',
    });
    expect(
      await new Promise<string>((resolve) =>
        client.once('error', (error) => resolve(error.message)),
      ),
    ).toContain('403');
  });
  it('rejects malformed protocol values before changing memory', async () => {
    const { client, state } = await setup();
    const closed = new Promise<number>((resolve) => client.once('close', resolve));
    client.send(
      JSON.stringify({
        type: 'applyEdit',
        requestId: 1,
        baseRevision: 0,
        edit: { kind: 'move', ref: 'structure:house', position: [1, 2], rotation: 0 },
      }),
    );
    expect(await closed).toBe(1008);
    expect(state.scene.revision).toBe(0);
  });
});
