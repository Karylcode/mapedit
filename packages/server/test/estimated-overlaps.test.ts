import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('F38 estimated overlaps never block a human edit', () => {
  it('moves a round Structure next to another on a map with 250 round overlaps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mapedit-estimates-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    // Rows of discs 1.5 m apart overlap 250 times, so later pairs of a full check are
    // estimates; zz_b then moves diagonally next to zz_a, where only the square bounds meet.
    const discs = Array.from(
      { length: 255 },
      (_, index) =>
        `  - id: c${String(index).padStart(3, '0')}\n    position: [${2 + (index % 51) * 1.5}, ${2 + Math.floor(index / 51) * 4}]\n    modules:\n      - {id: base, module: disc, at: [0, 0, 0]}\n`,
    ).join('');
    const files: Record<string, string> = {
      'project.yaml': 'name: Estimates\n',
      'modules/disc/module.yaml': 'size: [2, 2, 2]\n',
      'modules/disc/model.ts':
        "import {cylinder, translate} from '@mapedit/model'; export default translate(cylinder(1, 2), [1, 0, 1]);",
      'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/village/structures/discs.yaml': `structures:\n${discs}`,
      'maps/village/structures/pair.yaml':
        'structures:\n  - id: zz_a\n    position: [85, 90]\n    modules:\n      - {id: base, module: disc, at: [0, 0, 0]}\n  - id: zz_b\n    position: [92, 90]\n    modules:\n      - {id: base, module: disc, at: [0, 0, 0]}\n',
    };
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    const server = await createServer({ root, port: 0, webRoot: null });
    cleanup.push(() => server.close());
    const state = server.state;
    expect(state.scene.violations.some((item) => item.params.estimated)).toBe(true);
    const move = {
      kind: 'move',
      ref: 'structure:zz_b',
      position: [86.5, 0, 91.5],
      rotation: 0,
    } as const;
    const preview = await state.preview(move, 1, 'village');
    expect(preview.violations).toEqual([]);
    expect(preview.ok).toBe(true);
    expect(await state.apply(move, state.scene.revision, 'village')).toBeUndefined();
  });
});
