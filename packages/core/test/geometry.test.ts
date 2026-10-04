import { describe, expect, it } from 'vitest';
import { WebIO } from '@gltf-transform/core';
import type { Vec3 } from '@mapedit/protocol';
import {
  box,
  cylinder,
  difference,
  extrude,
  material,
  revolve,
  rotate,
  translate,
  union,
} from '../src/model-api.js';
import { buildModel } from '../src/model.js';
import { modelToGlb } from '../src/glb.js';
import { checkGeometry } from '../src/geometry.js';
import { parseProject } from '../src/format.js';
import { compileMap } from '../src/compiler.js';

function fixture(positions: Vec3[], properties = '', rotations: number[] = []) {
  return compileMap(
    parseProject({
      'project.yaml': 'name: Geometry test\n',
      'modules/test/module.yaml': `id: test\nsize: [2, 2, 2]\n${properties}`,
      'maps/test/map.yaml': 'name: Test\nsize: { x: 100, z: 100 }\n',
      'maps/test/structures/test.yaml': `structures:\n${positions.map((position, index) => `  - id: s${index}\n    position: [${position[0]}, ${position[2]}]\n    height: ${position[1]}\n    rotation: ${rotations[index] ?? 0}\n    modules:\n      - id: base\n        module: test\n        at: [0, 0, 0]`).join('\n')}\n`,
    }),
    'test',
  );
}

describe('manifold modelling and GLB', () => {
  it('makes Y-up cylinders, extrusions, and revolutions', async () => {
    const a = await buildModel(cylinder(1, 3));
    expect(a.bounds.min[1]).toBeCloseTo(0);
    expect(a.bounds.max[1]).toBeCloseTo(3);
    const b = await buildModel(
      extrude(
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
        ],
        3,
      ),
    );
    expect(b.bounds).toEqual({ min: [0, 0, 0], max: [2, 3, 1] });
    expect(b.volume).toBeCloseTo(6);
    const c = await buildModel(
      revolve([
        [0, 0],
        [1, 0],
        [1, 3],
        [0, 3],
      ]),
    );
    expect(c.bounds.min[1]).toBeCloseTo(0);
    expect(c.bounds.max[1]).toBeCloseTo(3);
  });
  it('preserves several materials, generates metre UVs, and declares mesh collision', async () => {
    const model = await buildModel(
      union(
        material('red', box([1, 1, 1])),
        translate(material('blue', box([1, 1, 1])), [1, 0, 0]),
      ),
    );
    const document = await new WebIO().readBinary(await modelToGlb(model));
    expect(
      document
        .getRoot()
        .listMaterials()
        .map((item) => item.getName())
        .sort(),
    ).toEqual(['blue', 'red']);
    expect(
      document
        .getRoot()
        .listMeshes()[0]!
        .listPrimitives()[0]!
        .getAttribute('TEXCOORD_0')!
        .getCount(),
    ).toBeGreaterThan(0);
    expect(document.getRoot().listNodes()[0]!.getExtras()).toEqual({
      mapedit: { kind: 'module', collider: { type: 'mesh' } },
    });
  });
  it('rejects dimensions, unknown materials and hostile recipes', async () => {
    await expect(buildModel(box([3, 2, 2]), [2, 2, 2])).rejects.toThrow('exceeds');
    await expect(buildModel(material('absent', box([1, 1, 1])))).rejects.toThrow(
      'Unknown material',
    );
    await expect(buildModel({ op: 'box', size: [Infinity, 1, 1] })).rejects.toThrow('Invalid');
    await expect(
      buildModel({ op: 'cylinder', radius: 1, height: 1, segments: 1e8 }),
    ).rejects.toThrow('Invalid');
  });
  it('keeps texture repeats at their physical metre scale on sloped triangles', async () => {
    const model = await buildModel(material('wood_planks', rotate(box([2, 1, 3]), [25, 30, 10])));
    const document = await new WebIO().readBinary(await modelToGlb(model));
    const primitive = document.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    const positions = primitive.getAttribute('POSITION')!.getArray()!;
    const uv = primitive.getAttribute('TEXCOORD_0')!.getArray()!;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 3) {
      const distance = Math.hypot(
        ...[0, 1, 2].map(
          (axis) => positions[(vertex + 1) * 3 + axis]! - positions[vertex * 3 + axis]!,
        ),
      );
      const uvDistance = Math.hypot(
        uv[(vertex + 1) * 2]! - uv[vertex * 2]!,
        uv[(vertex + 1) * 2 + 1]! - uv[vertex * 2 + 1]!,
      );
      expect(uvDistance * 1.5).toBeCloseTo(distance, 5);
    }
  });
});

describe('physical geometry rules', () => {
  it('compiles and checks 2000 Modules within the two-second budget', async () => {
    const models = new Map([['test', await buildModel(box([1, 1, 1]))]]);
    const start = performance.now();
    const compiled = fixture(
      Array.from({ length: 2000 }, (_, index): Vec3 => [
        2 + (index % 50) * 1.5,
        0,
        2 + Math.floor(index / 50) * 1.5,
      ]),
    );
    const checked = await checkGeometry(compiled, models);
    expect(checked.violations).toEqual([]);
    expect(compiled.instances).toHaveLength(2000);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  it('reports real overlap, but permits contact and numerical tolerance', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    expect(
      (
        await checkGeometry(
          fixture([
            [1, 0, 1],
            [2, 0, 1],
          ]),
          models,
        )
      ).violations.map((v) => v.kind),
    ).toContain('overlap');
    expect(
      (
        await checkGeometry(
          fixture([
            [1, 0, 1],
            [3, 0, 1],
          ]),
          models,
        )
      ).violations,
    ).toEqual([]);
    expect(
      (
        await checkGeometry(
          fixture([
            [1, 0, 1],
            [2.99999, 0, 1],
          ]),
          models,
        )
      ).violations,
    ).toEqual([]);
  });
  it('uses actual shape instead of bounding boxes, preserving door holes', async () => {
    const door = await buildModel(
      difference(box([2, 2, 2]), translate(box([1, 2, 3]), [0.5, 0, -0.5])),
    );
    const inside = await buildModel(box([0.5, 1, 1]));
    const compiled = fixture([
      [1, 0, 1],
      [1.5, 0, 1.5],
    ]);
    compiled.instances[1]!.moduleType = 'inside';
    expect(
      (
        await checkGeometry(
          compiled,
          new Map([
            ['test', door],
            ['inside', inside],
          ]),
        )
      ).violations,
    ).toEqual([]);
  });
  it('accepts stacked support, rejects airborne stacks, and permits canFloat', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    expect(
      (
        await checkGeometry(
          fixture([
            [1, 0, 1],
            [1, 2, 1],
            [1, 4, 1],
          ]),
          models,
        )
      ).violations,
    ).toEqual([]);
    expect(
      (
        await checkGeometry(
          fixture([
            [1, 3, 1],
            [1, 5, 1],
          ]),
          models,
        )
      ).violations.filter((v) => v.kind === 'unsupported'),
    ).toHaveLength(2);
    expect(
      (await checkGeometry(fixture([[1, 3, 1]], 'canFloat: true\n'), models)).violations,
    ).toEqual([]);
  });
  it('propagates socket Support from terrain but not from a floating cycle', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    const grounded = fixture([
      [1, 0, 1],
      [6, 2, 1],
    ]);
    grounded.socketConnections = [{ a: grounded.instances[0]!.ref, b: grounded.instances[1]!.ref }];
    expect((await checkGeometry(grounded, models)).violations).toEqual([]);
    const floating = fixture([
      [1, 3, 1],
      [6, 3, 1],
    ]);
    floating.socketConnections = [{ a: floating.instances[0]!.ref, b: floating.instances[1]!.ref }];
    expect(
      (await checkGeometry(floating, models)).violations.filter((v) => v.kind === 'unsupported'),
    ).toHaveLength(2);
  });
  it('checks rotated solids, terrain penetration and terrain-following exceptions', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    expect(
      (
        await checkGeometry(
          fixture(
            [
              [5, 0, 5],
              [5.5, 0, 5.5],
            ],
            '',
            [30, 0],
          ),
          models,
        )
      ).violations.map((v) => v.kind),
    ).toContain('overlap');
    expect(
      (await checkGeometry(fixture([[1, 0, 1]]), models, { heightAt: () => 0.5 })).violations.map(
        (v) => v.kind,
      ),
    ).toContain('overlap');
    expect(
      (
        await checkGeometry(fixture([[1, 0, 1]], 'terrainFollow: true\n'), models, {
          heightAt: () => 0.5,
        })
      ).violations,
    ).toEqual([]);
  });
  it('extends a rotated Foundation down to sloped terrain without moving it', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    const compiled = fixture([[5, 2, 5]], 'isFoundation: true\nfoundationStyle: skirt\n', [30]);
    const checked = await checkGeometry(compiled, models, { heightAt: (x) => x / 10 });
    expect(checked.violations).toEqual([]);
    expect(checked.generated).toHaveLength(1);
    expect(checked.generated[0]!.geometry.bounds.max[1]).toBeCloseTo(2);
    expect(checked.generated[0]!.geometry.bounds.min[1]).toBeLessThan(1);
    expect(compiled.instances[0]!.transform[13]).toBe(2);
  });
  it('allows a Foundation to define separated pillars instead of a solid skirt', async () => {
    const models = new Map([['test', await buildModel(box([2, 2, 2]))]]);
    const checked = await checkGeometry(
      fixture([[5, 2, 5]], 'isFoundation: true\nfoundationStyle: pillars\n'),
      models,
    );
    expect(checked.violations).toEqual([]);
    expect(checked.generated[0]!.geometry.volume).toBeCloseTo(0.5);
  });
});
