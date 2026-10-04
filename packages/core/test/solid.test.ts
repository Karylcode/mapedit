import { afterAll, describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import type { Vec3 } from '@mapedit/protocol';
import { box, difference, translate } from '../src/model-api.js';
import { buildModel, geometryMesh, getManifold } from '../src/model.js';
import { transformMatrix } from '../src/math.js';
import type { CompiledInstance } from '../src/domain.js';
import {
  fillsBounds,
  manifoldOverlap,
  moveSolid,
  overlapLocation,
  restsOn,
  type PlacedSolid,
} from '../src/solid.js';

const handles: Manifold[] = [];
afterAll(() => {
  for (const handle of handles.splice(0)) handle.delete();
});
async function placed(
  shape: Parameters<typeof buildModel>[0],
  position: Vec3,
  rotation = 0,
): Promise<PlacedSolid> {
  const library = await getManifold();
  const base = new library.Manifold(geometryMesh(library, await buildModel(shape)));
  const solid = base.transform(transformMatrix(position, rotation) as never);
  handles.push(base, solid);
  const bounds = solid.boundingBox();
  return {
    instance: { ref: `module:s/${handles.length}` } as CompiledInstance,
    solid,
    bounds,
    box: fillsBounds(base.volume(), bounds),
  };
}

describe('F20 exact box arithmetic', () => {
  it('detects which placed solids fill their bounds', async () => {
    expect((await placed(box([2, 2, 2]), [0, 0, 0])).box).toBe(true);
    expect((await placed(box([2, 1, 3]), [5, 0, 5], 90)).box).toBe(true);
    expect((await placed(box([2, 2, 2]), [0, 0, 0], 15)).box).toBe(false);
    const door = difference(box([2, 2, 2]), translate(box([0.8, 1.6, 2.2]), [0.6, 0, -0.1]));
    expect((await placed(door, [0, 0, 0])).box).toBe(false);
  });

  it('matches the Boolean result for overlap, contact and separation', async () => {
    const offsets: Vec3[] = [
      [1.5, 0, 0],
      [2, 0, 0],
      [2.00005, 0, 0],
      [1.99995, 0, 0],
      [1, 1, 1],
      [0, 2, 0],
      [0, 1.9999, 0],
      [0.5, -1.5, 0.25],
      [3, 0, 0],
      [-1.75, 0.5, 1.75],
    ];
    for (const offset of offsets) {
      const a = await placed(box([2, 2, 2]), [10, 0, 10]);
      const b = await placed(box([2, 2, 2]), [10 + offset[0], offset[1], 10 + offset[2]]);
      expect(a.box && b.box).toBe(true);
      const exact = overlapLocation({ ...a, box: false }, { ...b, box: false });
      const fast = overlapLocation(a, b);
      expect(fast === undefined, `overlap at offset ${offset}`).toBe(exact === undefined);
      if (exact && fast) fast.forEach((value, axis) => expect(value).toBeCloseTo(exact[axis]!, 9));
      for (const [upper, lower] of [
        [a, b],
        [b, a],
      ] as const)
        expect(restsOn(upper, lower), `rests at offset ${offset}`).toBe(
          restsOn({ ...upper, box: false }, { ...lower, box: false }),
        );
    }
    const a = await placed(box([2, 2, 2]), [10, 0, 10]);
    const b = await placed(box([2, 2, 2]), [11, 0.5, 10.5]);
    expect(overlapLocation(a, b)).toEqual(manifoldOverlap(a.solid, b.solid));
  });

  it('keeps the box flag only for moves that keep the solid axis-aligned', async () => {
    const a = await placed(box([2, 2, 2]), [10, 0, 10]);
    const shifted = moveSolid(a, transformMatrix([1, -0.5, 2]));
    const turned = moveSolid(a, transformMatrix([0, 0, 0], 90));
    const tilted = moveSolid(a, transformMatrix([0, 0, 0], 30));
    handles.push(shifted.solid, turned.solid, tilted.solid);
    expect([shifted.box, turned.box, tilted.box]).toEqual([true, true, false]);
  });
});
