import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from '../src/index.js';
import type { Edit } from '@mapedit/protocol';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function project(structures: string) {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-drag-violations-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files = {
    'project.yaml': 'name: Drag regression\n',
    'modules/block/module.yaml': 'id: block\nsize: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/test/structures/test.yaml': `structures:\n${structures}`,
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), contents);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  expect(server.state.scene.fileErrors).toEqual([]);
  return server.state;
}

const structure = (id: string, x: number, z: number, height = 0, rotation = true) =>
  `  - id: ${id}\n    position: [${x}, ${z}]\n    height: ${height}\n${rotation ? '    rotation: 0\n' : ''}    modules:\n      - id: base\n        module: block\n        at: [0, 0, 0]\n`;

describe('dragging while unrelated violations already exist', () => {
  it('still refuses a move that removes Support from another Structure', async () => {
    const state = await project(structure('a', 10, 10) + structure('b', 10, 10, 2));
    expect(state.scene.violations).toEqual([]);
    const edit: Edit = { kind: 'move', ref: 'structure:a', position: [20, 0, 10], rotation: 0 };
    const preview = await state.preview(edit, 3, 'test');
    expect(preview.ok).toBe(false);
    expect(preview.violations).toEqual([
      expect.objectContaining({ kind: 'unsupported', refs: ['module:b/base'] }),
    ]);
    expect(await state.apply(edit, 0, 'test')).toMatchObject({
      reason: expect.stringContaining('no Support'),
      failure: 'violations',
    });
    expect(state.scene.structures.find((value) => value.ref === 'structure:a')!.transform[12]).toBe(
      10,
    );
    expect(state.entries).toHaveLength(0);
  });
  it('moves one out-of-bounds Structure inside while the other stays out of bounds', async () => {
    const state = await project(structure('a', -4, 10) + structure('b', 104, 10));
    const previous = state.scene.violations.find(
      (violation) => violation.kind === 'out_of_bounds' && violation.refs.includes('structure:b'),
    );
    expect(previous).toBeDefined();
    const edit: Edit = { kind: 'move', ref: 'structure:a', position: [10, 0, 10], rotation: 0 };
    expect(await state.preview(edit, 1, 'test')).toMatchObject({ ok: true, violations: [] });
    expect(await state.apply(edit, 0, 'test')).toBeUndefined();
    expect(state.scene.structures.find((value) => value.ref === 'structure:a')!.transform[12]).toBe(
      10,
    );
    expect(state.scene.violations.find((violation) => violation.id === previous!.id)).toMatchObject(
      {
        kind: 'out_of_bounds',
        refs: ['module:b/base', 'structure:b'],
      },
    );
  });
  it('adds a missing rotation field without treating shifted unsupported diagnostics as new', async () => {
    const state = await project(structure('a', 10, 10, 0, false) + structure('b', 30, 10, 5));
    const previous = state.scene.violations.find(
      (violation) => violation.kind === 'unsupported' && violation.refs.includes('module:b/base'),
    );
    expect(previous).toBeDefined();
    const edit: Edit = { kind: 'move', ref: 'structure:a', position: [12, 0, 10], rotation: 15 };
    expect(await state.preview(edit, 2, 'test')).toMatchObject({ ok: true, violations: [] });
    expect(await state.apply(edit, 0, 'test')).toBeUndefined();
    const current = state.scene.violations.find((violation) => violation.id === previous!.id);
    expect(current).toMatchObject({ kind: 'unsupported', refs: ['module:b/base'] });
    expect(current!.params.line).not.toBe(previous!.params.line);
  });
});
