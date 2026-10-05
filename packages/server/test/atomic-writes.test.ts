import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DiskState, type ProjectFileOperations } from '../src/disk-state.js';
import { buildFromParsed, buildProject } from '../src/build-project.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const structure = (id: string, x: number) =>
  `structures:\n  - id: ${id}\n    position: [${x}, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n`;
/** A real project whose state writes through operations that fail when `failing` says so. */
async function project(failing: { rename?: number; writeFile?: number } = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'mapedit-atomic-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: Atomic writes\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/a.yaml': structure('a', 10),
    'maps/village/structures/b.yaml': structure('b', 20),
  };
  for (const [file, text] of Object.entries(files)) {
    await fs.mkdir(dirname(join(root, file)), { recursive: true });
    await fs.writeFile(join(root, file), text);
  }
  const calls = { rename: 0, writeFile: 0 };
  const io: ProjectFileOperations = {
    ...fs,
    async rename(from, to) {
      if (++calls.rename === failing.rename)
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${to}'`), {
          code: 'EBUSY',
        });
      return fs.rename(from, to);
    },
    async writeFile(file, data) {
      if (++calls.writeFile === failing.writeFile)
        throw Object.assign(new Error(`EBUSY: resource busy or locked, open '${file}'`), {
          code: 'EBUSY',
        });
      return fs.writeFile(file, data);
    },
  };
  const state = await DiskState.create(
    root,
    { build: (id, revision) => buildProject(root, id, revision), preview: buildFromParsed },
    io,
  );
  cleanup.push(() => state.close());
  const read = async () =>
    Object.fromEntries(
      await Promise.all(
        ['a', 'b'].map(async (id) => [
          id,
          await fs.readFile(join(root, `maps/village/structures/${id}.yaml`), 'utf8'),
        ]),
      ),
    );
  const leftovers = async () =>
    (await fs.readdir(join(root, 'maps/village/structures'))).filter((name) =>
      name.endsWith('.tmp'),
    );
  return { root, state, calls, failing, read, leftovers };
}

describe('F42 a human edit is written completely or not at all', () => {
  it('keeps every file and the history when the second file of an undo cannot be replaced', async () => {
    const { root, state, failing, read, leftovers } = await project();
    // One Agent change rewrites both files, so undoing it rewrites both again.
    await fs.writeFile(join(root, 'maps/village/structures/a.yaml'), structure('a', 30));
    await fs.writeFile(join(root, 'maps/village/structures/b.yaml'), structure('b', 40));
    await state.flush();
    expect(state.entries).toHaveLength(1);
    const before = await read();
    failing.rename = 2;
    await expect(state.travel(-1)).rejects.toThrow('EBUSY');
    expect(await read()).toEqual(before);
    expect(await leftovers()).toEqual([]);
    expect(state.cursor).toBe(1);
    // Nothing on disk changed, so the next refresh records nothing and redo stays as it was.
    await state.flush();
    expect(state.entries).toHaveLength(1);
    expect(state.cursor).toBe(1);
  });

  it('keeps the file and the history when an edit cannot be staged', async () => {
    const { state, failing, read, leftovers } = await project();
    const before = await read();
    failing.writeFile = 1;
    const move = { kind: 'move', ref: 'structure:a', position: [50, 0, 50], rotation: 0 } as const;
    await expect(state.apply(move, state.scene.revision, 'village')).rejects.toThrow('EBUSY');
    expect(await read()).toEqual(before);
    expect(await leftovers()).toEqual([]);
    expect(state.entries).toEqual([]);
    // The same edit succeeds once the file can be written.
    expect(await state.apply(move, state.scene.revision, 'village')).toBeUndefined();
    expect((await read()).a).toContain('position: [ 50, 50 ]');
  });
});
