import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type {
  ClientMessage,
  NoticeCode,
  SceneSnapshot,
  ServerMessage,
  ViolationKind,
} from '@mapedit/protocol';
import { createServer, type MapeditServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function mockServer() {
  const server = await createServer({ mock: true, port: 0 });
  cleanup.push(() => server.close());
  return server;
}

async function scene(server: MapeditServer): Promise<SceneSnapshot> {
  const response = await fetch(`${server.url}/api/scene?map=village`);
  expect(response.status).toBe(200);
  return (await response.json()) as SceneSnapshot;
}

async function editor(server: MapeditServer) {
  const socket = new WebSocket(`${server.url.replace('http:', 'ws:')}/ws`);
  const messages: ServerMessage[] = [];
  socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const wait = async <T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const index = () =>
      messages.findIndex(
        (message) =>
          message.type === type && predicate(message as Extract<ServerMessage, { type: T }>),
      );
    await expect.poll(index).toBeGreaterThanOrEqual(0);
    return messages.splice(index(), 1)[0] as Extract<ServerMessage, { type: T }>;
  };
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  await wait('welcome');
  send({ type: 'openMap', mapId: 'village' });
  const initial = (await wait('scene')).scene;
  await wait('history');
  return { wait, initial };
}

describe('F8 public mock coverage', () => {
  it('includes every violation kind with source information and useful spatial diagnostics', async () => {
    const snapshot = await scene(await mockServer());
    const kinds: ViolationKind[] = [
      'overlap',
      'incompatible_socket',
      'unsupported',
      'off_grid',
      'bad_rotation',
      'out_of_bounds',
      'missing_reference',
    ];
    expect([...new Set(snapshot.violations.map((violation) => violation.kind))].sort()).toEqual(
      kinds.sort(),
    );
    expect(new Set(snapshot.violations.map((violation) => violation.id)).size).toBe(
      snapshot.violations.length,
    );
    for (const violation of snapshot.violations) {
      expect(violation.refs.length).toBeGreaterThan(0);
      expect(violation.params).toMatchObject({
        file: expect.any(String),
        line: expect.any(Number),
      });
      expect(violation.suggestion?.length).toBeGreaterThan(0);
      if (violation.kind === 'overlap' || violation.kind === 'unsupported') {
        expect(violation.location).toHaveLength(3);
        expect(violation.location!.every(Number.isFinite)).toBe(true);
        expect(violation.suggestion).toMatch(/\b(?:east|west|north|south|down|socket|canFloat)\b/i);
      }
    }
  });

  it('includes a foundation extension and serves every referenced GLB', async () => {
    const server = await mockServer();
    const snapshot = await scene(server);
    expect(snapshot.generated.length).toBeGreaterThan(0);
    const instances = snapshot.structures.flatMap((structure) => structure.instances);
    for (const generated of snapshot.generated) {
      const owner = instances.find((instance) => instance.ref === generated.owner);
      expect(owner).toBeDefined();
      expect(
        snapshot.moduleTypes.find((module) => module.id === owner!.moduleType)?.isFoundation,
      ).toBe(true);
    }
    const urls = [
      ...snapshot.terrain.chunks.map((chunk) => chunk.url),
      ...snapshot.moduleTypes.map((module) => module.url),
      ...snapshot.generated.map((mesh) => mesh.url),
    ];
    for (const url of new Set(urls)) {
      const response = await fetch(new URL(url, server.url));
      expect(response.status, url).toBe(200);
      expect(response.headers.get('content-type')).toContain('model/gltf-binary');
      const glb = Buffer.from(await response.arrayBuffer());
      expect(glb.readUInt32LE(0), url).toBe(0x46546c67);
      expect(glb.readUInt32LE(4), url).toBe(2);
      expect(glb.readUInt32LE(8), url).toBe(glb.length);
    }
  });

  it('includes point and box markers plus a file error in the initial snapshot', async () => {
    const snapshot = await scene(await mockServer());
    expect(snapshot.markers.map((marker) => marker.shape.kind)).toEqual(
      expect.arrayContaining(['point', 'box']),
    );
    expect(snapshot.fileErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: expect.any(String),
          line: expect.any(Number),
          message: expect.any(String),
        }),
      ]),
    );
  });

  const notices: NoticeCode[] = [
    'agent_changed',
    'overwritten_by_agent',
    'agent_change_overridden',
    'edit_rejected',
    'file_error',
  ];
  for (const notice of notices)
    it(`simulates ${notice} through POST and sends its WebSocket notice`, async () => {
      const server = await mockServer();
      const { wait, initial } = await editor(server);
      const response = await fetch(`${server.url}/api/mock/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice }),
      });
      expect(response.ok).toBe(true);
      const result = await wait('notice', (message) => message.code === notice);
      expect(result.message.length).toBeGreaterThan(0);
      if (notice === 'file_error') {
        expect(result.level).toBe('error');
        const next = (await wait('scene', (message) => message.scene.revision > initial.revision))
          .scene;
        expect(next.fileErrors.length).toBe(initial.fileErrors.length + 1);
        expect(next.fileErrors).toEqual(expect.arrayContaining(initial.fileErrors));
        expect(await scene(server)).toEqual(next);
      } else if (notice === 'edit_rejected') {
        expect((await scene(server)).revision).toBe(initial.revision);
      } else {
        expect(result.refs?.length).toBeGreaterThan(0);
        await wait('scene', (message) => message.scene.revision > initial.revision);
        const expectedAuthors =
          notice === 'agent_changed'
            ? ['agent']
            : notice === 'overwritten_by_agent'
              ? ['human', 'agent']
              : ['agent', 'human'];
        const history = await wait(
          'history',
          (message) => message.entries.length >= expectedAuthors.length,
        );
        expect(history.entries.map((entry) => entry.author)).toEqual(expectedAuthors);
      }
    });

  it('rejects unknown notices without mutating the scene', async () => {
    const server = await mockServer();
    const initial = await scene(server);
    const response = await fetch(`${server.url}/api/mock/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice: 'unknown' }),
    });
    expect(response.status).toBe(400);
    expect(await scene(server)).toEqual(initial);
  });

  it('rejects malformed or oversized trigger bodies and foreign origins before mutation', async () => {
    const server = await mockServer();
    const initial = await scene(server);
    for (const [body, status] of [
      ['{', 400],
      [JSON.stringify({ notice: 'agent_changed', padding: 'x'.repeat(16_384) }), 413],
    ] as const) {
      const response = await fetch(`${server.url}/api/mock/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(response.status).toBe(status);
    }
    const foreign = await fetch(`${server.url}/api/mock/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://outside.test' },
      body: JSON.stringify({ notice: 'agent_changed' }),
    });
    expect(foreign.status).toBe(403);
    expect(await scene(server)).toEqual(initial);
  });

  it('does not expose the trigger on a real project server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mapedit-no-mock-trigger-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'maps/village'), { recursive: true });
    await writeFile(join(root, 'project.yaml'), 'name: Real project\n');
    await writeFile(join(root, 'maps/village/map.yaml'), 'size: {x: 100, z: 100}\n');
    const server = await createServer({ root, port: 0 });
    cleanup.push(() => server.close());
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${server.url}/api/mock/trigger`, {
        method,
        ...(method === 'POST'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ notice: 'agent_changed' }),
            }
          : {}),
      });
      expect(response.status).toBe(404);
    }
    expect(server.state.scene.revision).toBe(0);
    expect(server.state.entries).toEqual([]);
  });
});
