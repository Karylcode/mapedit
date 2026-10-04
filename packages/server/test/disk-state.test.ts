import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { compileMap, type ParsedProject } from '@mapedit/core';
import { DiskState } from '../src/disk-state.js';
import type { BuiltProject } from '../src/build-project.js';
import { readProject } from '../src/project-files.js';
import { createServer, type MapeditServer } from '../src/index.js';
import type { ServerMessage } from '@mapedit/protocol';

const roots: string[] = [],
  servers: MapeditServer[] = [],
  states: DiskState[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await Promise.all(states.splice(0).map((s) => s.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const house =
  '# Preserve this comment\nstructures:\n  - id: house\n    position: [10, 10] # keep coordinate note\n    rotation: 0\n    modules:\n      - { id: base, module: block, at: [0, 0, 0] }\n';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-state-'));
  roots.push(root);
  const files = {
    'project.yaml': 'name: Test\n',
    'modules/block/module.yaml': 'id: block\nsize: [2, 2, 2]\n',
    'maps/village/map.yaml': 'name: Village\nsize: { x: 100, z: 100 }\n',
    'maps/village/structures/house.yaml': house,
    'maps/village/markers.yaml': 'markers: []\n',
    'maps/second/map.yaml': 'name: Second\nsize: { x: 100, z: 100 }\n',
    'maps/second/structures/house.yaml': house,
  };
  for (const [file, data] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), data);
  }
  const build = (parsed: ParsedProject, id: string | undefined, revision: number): BuiltProject => {
    const compilation = compileMap(parsed, id, { revision, terrainHeight: () => 1 });
    return {
      root,
      parsed,
      compilation,
      scene: compilation.scene,
      assets: new Map(),
      terrain: {
        width: 100,
        depth: 100,
        heights: new Float32Array(10_000).fill(1),
        surfaces: new Uint8Array(10_000),
      },
      geometries: new Map(),
      generated: [],
      moduleUrls: new Map(),
      heightAt: () => 1,
    };
  };
  const state = await DiskState.create(root, {
    build: async (id, revision) => build(await readProject(root), id, revision),
    preview: async (parsed, id, revision) => build(parsed, id, revision),
  });
  states.push(state);
  return { root, state };
}

describe('disk state project history', () => {
  it('keeps drag frames in memory and reads direct file changes before applying an edit', async () => {
    const { root, state } = await fixture();
    const server = await createServer({ port: 0, state });
    servers.push(server);
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
    await new Promise<void>((resolve) => socket.once('open', resolve));
    let requestId = 0;
    const request = async (message: Record<string, unknown>, type: ServerMessage['type']) => {
      const id = ++requestId;
      const response = new Promise<ServerMessage>((resolve) => {
        const receive = (data: Buffer) => {
          const value = JSON.parse(data.toString()) as ServerMessage;
          if (value.type === type && (!('requestId' in value) || value.requestId === id)) {
            socket.off('message', receive);
            resolve(value);
          }
        };
        socket.on('message', receive);
      });
      socket.send(JSON.stringify({ ...message, requestId: id }));
      return response;
    };
    await request({ type: 'hello', protocolVersion: 1, client: 'editor' }, 'welcome');
    await request({ type: 'openMap', mapId: 'village' }, 'scene');
    const scan = vi.spyOn(fs, 'readdir');
    syncBuiltinESMExports();
    const edit = { kind: 'move', ref: 'structure:house', position: [15, 0, 15], rotation: 0 };
    try {
      for (let frame = 0; frame < 3; frame++)
        expect(await request({ type: 'previewEdit', edit }, 'previewResult')).toMatchObject({
          ok: true,
        });
      expect(scan).not.toHaveBeenCalled();
      const file = join(root, 'maps/village/structures/house.yaml');
      await writeFile(
        file,
        house.replace('id: house', 'id: house\n    name: Agent changed this while dragging'),
      );
      expect((await state.getScene('village')).structures[0]!.name).toBeUndefined();
      expect(
        await request({ type: 'applyEdit', edit, baseRevision: 0 }, 'editResult'),
      ).toMatchObject({ ok: true });
      expect(scan).toHaveBeenCalled();
      expect(await readFile(file, 'utf8')).toContain('name: Agent changed this while dragging');
      const scene = await state.getScene('village');
      expect(scene.structures[0]!.name).toBe('Agent changed this while dragging');
      expect(scene.structures[0]!.transform.slice(12, 15)).toEqual([15, 1, 15]);
      expect(state.entries.map((entry) => entry.author)).toEqual(['agent', 'human']);
    } finally {
      scan.mockRestore();
      syncBuiltinESMExports();
      socket.terminate();
    }
  });
  it('previews under 30 ms on a village map, snaps, rejects bounds and preserves YAML comments', async () => {
    const { root, state } = await fixture();
    const edit = {
      kind: 'move' as const,
      ref: 'structure:house',
      position: [14.2, 88, 16.8] as [number, number, number],
      rotation: 16,
    };
    await state.preview(edit, 0, 'village');
    const elapsed = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const result = await state.preview(edit, i, 'village');
      elapsed.push(performance.now() - start);
      expect(result.ok).toBe(true);
      expect(result.transform?.slice(12, 15)).toEqual([14, 1, 17]);
    }
    expect(elapsed.sort((a, b) => a - b)[5]).toBeLessThan(30);
    expect(await readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8')).toBe(house);
    expect(await state.apply({ ...edit, position: [-10, 0, 0] }, 0, 'village')).toContain(
      'outside',
    );
    expect(await state.apply(edit, 0, 'village')).toBeUndefined();
    const text = await readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8');
    expect(text).toContain('# Preserve this comment');
    expect(text).toContain('[14, 17] # keep coordinate note');
    expect(state.cursor).toBe(1);
  });
  it('flushes files immediately, records Agent edits and detects both overwrite directions', async () => {
    const { root, state } = await fixture();
    await state.getScene('village');
    const messages: ServerMessage[] = [];
    state.on('message', (message) => messages.push(message));
    const edit = {
      kind: 'move' as const,
      ref: 'structure:house',
      position: [12, 0, 12] as [number, number, number],
      rotation: 0,
    };
    await state.apply(edit, 0, 'village');
    await writeFile(
      join(root, 'maps/village/structures/house.yaml'),
      house.replace('[10, 10]', '[20, 20]'),
    );
    await state.flush();
    expect((await state.getScene('village')).structures[0]!.transform.slice(12, 15)).toEqual([
      20, 1, 20,
    ]);
    expect(messages.filter((m) => m.type === 'notice').map((m) => m.code)).toContain(
      'overwritten_by_agent',
    );
    expect(state.entries.map((e) => e.author)).toEqual(['human', 'agent']);
    await state.apply(edit, 1, 'village');
    expect(messages.filter((m) => m.type === 'notice').map((m) => m.code)).toContain(
      'agent_change_overridden',
    );
    await state.travel(-1);
    expect(await readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8')).toContain(
      '[20, 20]',
    );
    await state.travel(-1);
    expect(await readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8')).toContain(
      '[12, 12]',
    );
    await state.travel(1);
    expect(await readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8')).toContain(
      '[20, 20]',
    );
  });
  it('tracks created and deleted files and broken YAML through project-wide undo', async () => {
    const { root, state } = await fixture();
    const file = join(root, 'maps/village/structures/new.yaml');
    await writeFile(file, 'structures: [\n');
    await state.flush();
    expect(state.scene.fileErrors).toHaveLength(1);
    await state.travel(-1);
    expect(
      await readFile(file).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await state.travel(1);
    expect(await readFile(file, 'utf8')).toBe('structures: [\n');
  });
  it('does not report overwrites for other objects sharing a file or another map', async () => {
    const { root, state } = await fixture();
    const file = join(root, 'maps/village/structures/house.yaml');
    await writeFile(
      file,
      house +
        house
          .slice(house.indexOf('  - id:'))
          .replace('id: house', 'id: other')
          .replace('[10, 10]', '[20, 20]'),
    );
    await state.flush();
    await state.apply(
      { kind: 'move', ref: 'structure:house', position: [12, 0, 12], rotation: 0 },
      state.scene.revision,
      'village',
    );
    const messages: ServerMessage[] = [];
    state.on('message', (message) => messages.push(message));
    await writeFile(file, (await readFile(file, 'utf8')).replace('[20, 20]', '[21, 21]'));
    await state.flush();
    await writeFile(
      join(root, 'maps/second/structures/house.yaml'),
      house.replace('[10, 10]', '[22, 22]'),
    );
    await state.getScene('second');
    await state.flush();
    expect(
      messages.filter((message) => message.type === 'notice').map((message) => message.code),
    ).not.toContain('overwritten_by_agent');
  });
  it('watches authoring files without requiring an incoming client request', async () => {
    const { root, state } = await fixture();
    await state.getScene('village');
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(
      join(root, 'maps/village/structures/house.yaml'),
      house.replace('[10, 10]', '[21, 21]'),
    );
    await expect.poll(() => state.entries.length, { timeout: 3000 }).toBe(1);
    expect((await state.getScene('village')).structures[0]!.transform[12]).toBe(21);
  });
  it('keeps two WebSocket maps independent and shares project history', async () => {
    const { state } = await fixture();
    const server = await createServer({ port: 0, state });
    servers.push(server);
    const connect = async (mapId: string) => {
      const client = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
      const messages: ServerMessage[] = [];
      client.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      await new Promise<void>((resolve) => client.once('open', resolve));
      client.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: 'editor' }));
      client.send(JSON.stringify({ type: 'openMap', mapId }));
      await expect.poll(() => messages.some((m) => m.type === 'scene')).toBe(true);
      return { client, messages };
    };
    const one = await connect('village'),
      two = await connect('second');
    one.messages.length = 0;
    two.messages.length = 0;
    one.client.send(
      JSON.stringify({
        type: 'applyEdit',
        requestId: 1,
        baseRevision: 0,
        edit: { kind: 'move', ref: 'structure:house', position: [15, 0, 15], rotation: 0 },
      }),
    );
    await expect.poll(() => one.messages.some((m) => m.type === 'editResult')).toBe(true);
    expect(
      one.messages.filter((m) => m.type === 'scene').every((m) => m.scene.map.id === 'village'),
    ).toBe(true);
    expect(
      two.messages.filter((m) => m.type === 'scene').every((m) => m.scene.map.id === 'second'),
    ).toBe(true);
    expect((await state.getScene('second')).structures[0]!.transform[12]).toBe(10);
    expect((await state.getScene('village')).structures[0]!.transform[12]).toBe(15);
    one.client.terminate();
    two.client.terminate();
  });
});
