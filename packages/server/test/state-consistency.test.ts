import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Edit, ServerMessage } from '@mapedit/protocol';
import { MemoryState } from '../src/state.js';
import { DiskState } from '../src/disk-state.js';
import { buildProject, buildFromParsed } from '../src/build-project.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const structure = (x: number) => `structures:
  - id: house
    position: [${x}, 10]
    rotation: 0
    modules: [{id: base, module: block, at: [0, 0, 0]}]
`;
const move = (x: number): Edit => ({
  kind: 'move',
  ref: 'structure:house',
  position: [x, 0, 10],
  rotation: 0,
});
async function fixture(kind: 'memory' | 'disk', source = structure(10)) {
  let state: MemoryState | DiskState;
  let agent: (x: number) => Promise<void>;
  let brokenFile: () => Promise<void>;
  if (kind === 'memory') {
    const memory = new MemoryState();
    state = memory;
    agent = async (x) => {
      const scene = structuredClone(memory.scene);
      scene.structures[0]!.transform[12] = x;
      scene.structures[0]!.instances[0]!.transform[12] = x;
      memory.replaceFromAgent(scene, ['structure:house']);
    };
    brokenFile = async () => {
      const scene = structuredClone(memory.scene);
      scene.fileErrors.push({
        file: 'maps/village/structures/new-broken.yaml',
        line: 1,
        message: 'Invalid YAML.',
      });
      memory.replaceFromAgent(scene, [], ['maps/village/structures/new-broken.yaml']);
    };
  } else {
    const root = await mkdtemp(join(tmpdir(), 'mapedit-state-consistency-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const files = {
      'project.yaml': 'name: Consistent history\n',
      'modules/block/module.yaml':
        'size: [2, 2, 2]\nsockets:\n  - {id: east, type: wall, position: [2, 1, 1], direction: east}\n  - {id: west, type: wall, position: [0, 1, 1], direction: west}\n',
      'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
      'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/village/structures/house.yaml': source,
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    const disk = await DiskState.create(root, {
      build: (id, revision) => buildProject(root, id, revision),
      preview: buildFromParsed,
    });
    state = disk;
    agent = async (x) => {
      await writeFile(join(root, 'maps/village/structures/house.yaml'), structure(x));
      await disk.flush();
    };
    brokenFile = async () => {
      await writeFile(join(root, 'maps/village/structures/new-broken.yaml'), 'structures: [\n');
      await disk.flush();
    };
  }
  cleanup.push(() => state.close());
  const messages: ServerMessage[] = [];
  state.on('message', (message) => messages.push(structuredClone(message)));
  return { state, agent, brokenFile, messages };
}

describe('F15 shared memory/disk history and notice behavior', () => {
  it('keeps a merged child source reference deletable although it has no separate scene structure', async () => {
    const { state } = await fixture(
      'disk',
      structure(10) +
        `  - id: guest
    attach: {socket: base.west, to: house/base.east}
    modules: [{id: base, module: block, at: [0, 0, 0]}]
`,
    );
    expect(state.scene.structures).toHaveLength(1);
    expect(state.scene.structures[0]!.instances).toHaveLength(2);
    const edit: Edit = { kind: 'delete', ref: 'structure:guest' };
    expect((await state.preview(edit, 1)).ok).toBe(true);
    expect(await state.apply(edit, state.scene.revision)).toBeUndefined();
    expect(state.scene.structures[0]!.instances).toHaveLength(1);
  });
  for (const kind of ['memory', 'disk'] as const) {
    it(`${kind}: rejects stale references without adding history or changing revision`, async () => {
      const { state } = await fixture(kind);
      const revision = state.scene.revision;
      for (const ref of ['structure:gone', 'module:house/gone', 'marker:gone']) {
        const edit: Edit = { kind: 'delete', ref };
        const preview = await state.preview(edit, 1);
        expect(preview.ok).toBe(false);
        expect(preview.violations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: 'missing_reference', refs: [ref] }),
          ]),
        );
        expect(await state.apply(edit, revision)).toMatchObject({ reason: expect.any(String) });
        expect(state.scene.revision).toBe(revision);
        expect(state.entries).toEqual([]);
      }
    });
    it(`${kind}: assigns fresh IDs after undo then a new edit and restores exact checkpoints`, async () => {
      const { state } = await fixture(kind);
      expect(await state.apply(move(12), state.scene.revision)).toBeUndefined();
      expect(await state.apply(move(14), state.scene.revision)).toBeUndefined();
      const removedId = state.entries.at(-1)!.id;
      expect(await state.travel(-1)).toBeUndefined();
      expect(state.scene.structures[0]!.transform[12]).toBe(12);
      expect(await state.apply(move(16), state.scene.revision)).toBeUndefined();
      expect(state.entries.at(-1)!.id).toBeGreaterThan(removedId);
      expect(state.cursor).toBe(2);
      expect(state.entries).toHaveLength(2);
      expect(await state.travel(1)).toEqual({
        reason: 'Nothing to redo.',
        failure: 'nothing_to_redo',
      });
      for (const [direction, x] of [
        [-1, 12],
        [-1, 10],
        [1, 12],
        [1, 16],
      ] as const) {
        const revision = state.scene.revision;
        expect(await state.travel(direction)).toBeUndefined();
        expect(state.scene.structures[0]!.transform[12]).toBe(x);
        expect(state.scene.revision).toBeGreaterThan(revision);
      }
    });

    it(`${kind}: keeps Agent changes in the same undo/redo history`, async () => {
      const { state, agent } = await fixture(kind);
      await state.apply(move(12), state.scene.revision);
      await agent(14);
      expect(state.entries.map((entry) => entry.author)).toEqual(['human', 'agent']);
      expect(state.entries.map((entry) => entry.id)).toEqual([1, 2]);
      for (const entry of state.entries) {
        expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
        expect(entry.summary.length).toBeGreaterThan(0);
        expect(entry.files).toContain('maps/village/structures/house.yaml');
      }
      expect(await state.travel(-1)).toBeUndefined();
      expect(state.scene.structures[0]!.transform[12]).toBe(12);
      expect(await state.travel(1)).toBeUndefined();
      expect(state.scene.structures[0]!.transform[12]).toBe(14);
    });

    it(`${kind}: uses matching levels and refs for every notice`, async () => {
      const { state, agent, brokenFile, messages } = await fixture(kind);
      expect(await state.apply(move(-10), state.scene.revision)).toMatchObject({
        reason: expect.any(String),
        failure: 'violations',
      });
      await state.apply(move(12), state.scene.revision);
      const dragRevision = state.scene.revision;
      await agent(14);
      await state.apply(move(16), dragRevision);
      await brokenFile();
      const notices = messages.filter((message) => message.type === 'notice');
      for (const code of [
        'edit_rejected',
        'agent_changed',
        'overwritten_by_agent',
        'agent_change_overridden',
        'file_error',
      ]) {
        const notice = notices.find((message) => message.code === code);
        expect(notice, code).toBeDefined();
        expect(notice!.level).toBe(code === 'file_error' ? 'error' : 'warning');
        expect(notice!.message.length).toBeGreaterThan(0);
        if (code === 'file_error') expect(notice!.refs).toBeUndefined();
        else expect(notice!.refs).toContain('structure:house');
      }
    });
  }
});
