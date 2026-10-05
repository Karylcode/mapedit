import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import type { ServerMessage } from '@mapedit/protocol';
import { createServer, type MapeditServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const structure = (id: string, x: number) =>
  `structures:\n  - id: ${id}\n    position: [${x}, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n`;
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-notice-order-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: Notice order\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/a.yaml': structure('a', 10),
    'maps/town/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/town/structures/a.yaml': structure('a', 10),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0, webRoot: null });
  cleanup.push(() => server.close());
  return { root, server };
}

async function editor(server: MapeditServer, mapId: string) {
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  cleanup.push(async () => socket.terminate());
  const received: ServerMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  const index = async (match: (message: ServerMessage) => boolean, from = 0) => {
    await expect
      .poll(() => received.findIndex((m, i) => i >= from && match(m)))
      .toBeGreaterThan(-1);
    return received.findIndex((m, i) => i >= from && match(m));
  };
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  send({ type: 'openMap', mapId });
  await index((m) => m.type === 'history');
  return { send, index, received };
}
const notice = (code: string) => (message: ServerMessage) =>
  message.type === 'notice' && message.code === code;
const newScene = (mapId: string, after: number) => (message: ServerMessage) =>
  message.type === 'scene' && message.scene.map.id === mapId && message.scene.revision > after;

describe('F35 notices follow the new scene and name their map', () => {
  it('sends the new scene and history before Agent notices, with the map id', async () => {
    const { root, server } = await project();
    const village = await editor(server, 'village');
    const town = await editor(server, 'town');
    const revision = server.state.scene.revision;
    await writeFile(join(root, 'maps/village/structures/a.yaml'), structure('a', 30));
    const changed = await village.index(notice('agent_changed'));
    const scene = await village.index(newScene('village', revision));
    const history = await village.index((m) => m.type === 'history', scene);
    expect(scene).toBeLessThan(changed);
    expect(history).toBeLessThan(changed);
    expect(village.received[changed]).toMatchObject({
      mapId: 'village',
      refs: expect.arrayContaining(['structure:a', 'module:a/base']),
    });
    // The town editor hears about the village change with the village id and no town scene.
    const elsewhere = await town.index(notice('agent_changed'));
    expect(town.received[elsewhere]).toMatchObject({ mapId: 'village' });
    // A change on the town map reaches the village editor marked as a town change.
    const before = village.received.length;
    await writeFile(join(root, 'maps/town/structures/a.yaml'), structure('a', 40));
    const townChange = await village.index(notice('agent_changed'), before);
    expect(village.received[townChange]).toMatchObject({
      mapId: 'town',
      refs: expect.arrayContaining(['structure:a']),
    });
    const townScene = await town.index(newScene('town', revision + 1));
    expect(townScene).toBeLessThan(await town.index(notice('agent_changed'), townScene));
  });

  it('sends overwritten_by_agent after the scene, and edit notices with the map id', async () => {
    const { root, server } = await project();
    const village = await editor(server, 'village');
    village.send({
      type: 'applyEdit',
      requestId: 1,
      baseRevision: server.state.scene.revision,
      edit: { kind: 'move', ref: 'structure:a', position: [20, 0, 20], rotation: 0 },
    });
    await village.index((m) => m.type === 'editResult' && m.ok);
    const revision = server.state.scene.revision;
    const before = village.received.length;
    await writeFile(join(root, 'maps/village/structures/a.yaml'), structure('a', 60));
    const overwritten = await village.index(notice('overwritten_by_agent'), before);
    expect(await village.index(newScene('village', revision), before)).toBeLessThan(overwritten);
    expect(village.received[overwritten]).toMatchObject({
      mapId: 'village',
      refs: expect.arrayContaining(['structure:a']),
    });
    village.send({
      type: 'applyEdit',
      requestId: 2,
      baseRevision: server.state.scene.revision,
      edit: { kind: 'move', ref: 'module:a/base', position: [20, 0, 20], rotation: 0 },
    });
    const rejected = await village.index(notice('edit_rejected'));
    expect(village.received[rejected]).toMatchObject({
      mapId: 'village',
      refs: ['module:a/base'],
    });
  });

  it('does the same in mock mode', async () => {
    const server = await createServer({ mock: true, port: 0 });
    cleanup.push(() => server.close());
    const village = await editor(server, 'village');
    const revision = server.state.scene.revision;
    await fetch(`${server.url}/api/mock/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice: 'agent_changed' }),
    });
    const changed = await village.index(notice('agent_changed'));
    expect(await village.index(newScene('village', revision))).toBeLessThan(changed);
    expect(village.received[changed]).toMatchObject({ mapId: 'village' });
  });
});
