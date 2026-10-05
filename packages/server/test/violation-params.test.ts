import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { violationParamsProblems, type ViolationView } from '@mapedit/protocol';
import { MemoryState, mockScene } from '../src/index.js';
import { DiskState } from '../src/disk-state.js';
import { buildFromParsed, buildProject } from '../src/build-project.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const expectDocumented = (violations: ViolationView[]) => {
  for (const violation of violations)
    expect(violationParamsProblems(violation), JSON.stringify(violation)).toEqual([]);
};
const reasons = (violations: ViolationView[]) => violations.map((item) => item.params.reason);

describe('F23 mock violations follow protocol section 3', () => {
  it('documents the params of every violation kind in the mock scene', () => {
    const { violations } = mockScene();
    expectDocumented(violations);
    expect(new Set(violations.map((violation) => violation.kind))).toEqual(
      new Set([
        'overlap',
        'unsupported',
        'off_grid',
        'bad_rotation',
        'out_of_bounds',
        'missing_reference',
        'incompatible_socket',
      ]),
    );
  });

  it('documents the params of mock preview violations', async () => {
    const state = new MemoryState();
    const previews = await Promise.all([
      state.preview({ kind: 'delete', ref: 'structure:ghost' }, 1),
      state.preview(
        { kind: 'move', ref: 'module:house/base', position: [5, 0, 5], rotation: 0 },
        2,
      ),
      state.preview(
        { kind: 'move', ref: 'structure:house', position: [99, 0, -3], rotation: 0 },
        3,
      ),
    ]);
    const violations = previews.flatMap((preview) => preview.violations);
    expectDocumented(violations);
    expect(reasons(violations.slice(0, 2))).toEqual(['unknown_object', 'immovable_object']);
    expect(violations[2]).toMatchObject({
      kind: 'out_of_bounds',
      params: {
        edges: [
          { edge: 'north', distance: 3 },
          { edge: 'east', distance: 1 },
        ],
      },
    });
  });
});

it('F23 documents the params of real editor preview violations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-f23-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: Params\n',
    'modules/block/module.yaml':
      'size: [2, 2, 2]\nsockets:\n  - {id: east, type: wall, position: [2, 1, 1], direction: east}\n  - {id: west, type: wall, position: [0, 1, 1], direction: west}\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/house.yaml':
      'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n  - id: annex\n    attach: {socket: base.west, to: house/base.east}\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const state = await DiskState.create(root, {
    build: (id, revision) => buildProject(root, id, revision),
    preview: buildFromParsed,
  });
  cleanup.push(() => state.close());
  const move = (ref: string, position: [number, number, number]) =>
    state.preview({ kind: 'move', ref, position, rotation: 0 }, 1);
  const previews = await Promise.all([
    move('structure:ghost', [20, 0, 20]),
    move('module:house/base', [20, 0, 20]),
    move('structure:annex', [20, 0, 20]),
    move('structure:house', [99, 0, 10]),
  ]);
  const violations = previews.flatMap((preview) => preview.violations);
  expectDocumented(violations);
  expect(reasons(violations.slice(0, 3))).toEqual([
    'unknown_object',
    'immovable_object',
    'immovable_object',
  ]);
  expect(violations.slice(3).map((item) => item.kind)).toContain('out_of_bounds');
});
