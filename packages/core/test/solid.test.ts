import { afterAll, describe, expect, it } from 'vitest';
import type { Manifold } from 'manifold-3d';
import type { Vec3 } from '@mapedit/protocol';
import { box, difference, translate } from '../src/model-api.js';
import { buildModel, geometryMesh, getManifold } from '../src/model.js';
import { transformMatrix } from '../src/math.js';
import type { CompiledInstance } from '../src/domain.js';
import {
  fillsBounds,
  intersectsBounds,
  manifoldOverlap,
  moveSolid,
  orientedBox,
  orientedBoxesOverlap,
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
  const matrix = transformMatrix(position, rotation);
  const solid = base.transform(matrix as never);
  handles.push(base, solid);
  const bounds = solid.boundingBox();
  return {
    instance: { ref: `module:s/${handles.length}` } as CompiledInstance,
    solid,
    bounds,
    box: fillsBounds(base.volume(), bounds),
    oriented: orientedBox(base.boundingBox(), matrix),
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

  it('F32 skips Booleans for solids whose oriented bounds are apart, with the same results', async () => {
    const wall = box([2, 2, 0.3]);
    const a = await placed(wall, [10, 0, 10], 30);
    const across = (distance: number): Vec3 => [
      10 + distance / 2,
      0,
      10 + distance * Math.cos(Math.PI / 6),
    ];
    const others = [
      // Parallel walls 0.6 m apart: their map-axis bounds overlap, the walls do not.
      await placed(wall, [10, 0, 10.6], 30),
      // Touching faces, sunk 0.00005 m into each other, and 0.0002 m apart.
      await placed(wall, across(0.3), 30),
      await placed(wall, across(0.29995), 30),
      await placed(wall, across(0.3002), 30),
      // A crossing wall, a wall standing on top, and one turned the other way nearby.
      await placed(wall, [11.4, 0, 10.4], 120),
      await placed(wall, [10, 2, 10], 30),
      await placed(wall, [11, 0, 11], 75),
    ];
    const exact = ({ oriented: _, ...entry }: PlacedSolid): PlacedSolid => entry;
    for (const [index, other] of others.entries()) {
      expect(overlapLocation(a, other), `overlap ${index}`).toEqual(
        overlapLocation(exact(a), exact(other)),
      );
      expect(restsOn(other, a), `rests ${index}`).toBe(restsOn(exact(other), exact(a)));
      expect(restsOn(a, other), `supports ${index}`).toBe(restsOn(exact(a), exact(other)));
    }
    let booleans = 0;
    expect(intersectsBounds(a.bounds, others[0]!.bounds)).toBe(true);
    expect(orientedBoxesOverlap(a.oriented!, others[0]!.oriented!)).toBe(false);
    expect(overlapLocation(a, others[0]!, () => booleans++)).toBeUndefined();
    expect(booleans).toBe(0);
    expect(overlapLocation(a, others[4]!, () => booleans++)).toBeDefined();
    expect(booleans).toBe(1);
  });

  it('F32 moves the oriented bounds with the solid', async () => {
    const a = await placed(box([2, 2, 0.3]), [10, 0, 10], 30);
    const moved = moveSolid(a, transformMatrix([1, 2, 3], 45));
    handles.push(moved.solid);
    const corners = moved.solid.boundingBox();
    const box2 = moved.oriented!;
    // Every corner of the moved oriented box stays inside the moved solid's map bounds.
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const point = [0, 1, 2].map(
            (axis) =>
              box2.center[axis]! +
              sx * box2.half[0] * box2.axes[0][axis]! +
              sy * box2.half[1] * box2.axes[1][axis]! +
              sz * box2.half[2] * box2.axes[2][axis]!,
          );
          point.forEach((value, axis) => {
            expect(value).toBeGreaterThanOrEqual(corners.min[axis]! - 1e-6);
            expect(value).toBeLessThanOrEqual(corners.max[axis]! + 1e-6);
          });
        }
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
