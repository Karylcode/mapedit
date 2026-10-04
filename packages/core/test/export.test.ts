import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { WebIO } from '@gltf-transform/core';
import { stringify } from 'yaml';
import { parseProject } from '../src/format.js';
import { compileMap } from '../src/compiler.js';
import { exportMapGlb } from '../src/export.js';
import { box, material } from '../src/model-api.js';
import { buildModel } from '../src/model.js';
import { createTerrain } from '../src/terrain.js';

function compilation(
  options: {
    positions?: [number, number][];
    height?: number;
    rotation?: number;
    foundation?: boolean;
  } = {},
) {
  const structures = (options.positions ?? [[10, 10]]).map((position, index) => ({
    id: `house_${index}`,
    position,
    rotation: options.rotation ?? 0,
    height: options.height ?? 0,
    modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
  }));
  return compileMap(
    parseProject({
      'project.yaml': 'name: Export\n',
      'modules/block/module.yaml': `id: block\nsize: [2,2,2]\nisFoundation: ${options.foundation ?? false}\n`,
      'maps/test/map.yaml': 'name: Test\nsize: {x: 100, z: 100}\n',
      'maps/test/structures/house.yaml': stringify({ structures }),
      'maps/test/markers.yaml': stringify({
        markers: [
          {
            id: 'spawn',
            type: 'spawn',
            shape: { kind: 'point', position: [5, 0, 5], rotation: 30 },
            properties: { team: 'blue' },
          },
          {
            id: 'zone',
            type: 'trigger',
            shape: { kind: 'box', center: [7, 1, 7], size: [2, 2, 2], rotation: 15 },
            properties: { event: 'welcome' },
          },
        ],
      }),
    }),
    'test',
  );
}

it('round-trips hierarchy, world transforms, embedded material images and collider/Marker extras', async () => {
  const compiled = compilation({ rotation: 30 });
  const geometry = await buildModel(material('wood_planks', box([2, 2, 2])));
  const image = new Uint8Array(
    await readFile(new URL('../materials/wood_planks.jpg', import.meta.url)),
  );
  const bytes = await exportMapGlb({
    compilation: compiled,
    models: new Map([['block', geometry]]),
    terrain: createTerrain(100, 100),
    textures: { 'wood_planks.jpg': image },
  });
  const document = await new WebIO().readBinary(bytes),
    nodes = document.getRoot().listNodes();
  const root = nodes.find((node) => node.getName() === 'test')!,
    structure = nodes.find((node) => node.getName() === 'house_0')!,
    instance = nodes.find((node) => node.getName() === 'base')!;
  expect(root.listChildren()).toContain(structure);
  expect(structure.listChildren()).toContain(instance);
  instance
    .getWorldMatrix()
    .forEach((value, index) =>
      expect(value).toBeCloseTo(compiled.instances[0]!.transform[index]!, 7),
    );
  expect(instance.getExtras()).toEqual({
    mapedit: {
      kind: 'module',
      ref: 'module:house_0/base',
      moduleType: 'block',
      collider: { type: 'mesh' },
    },
  });
  expect(document.getRoot().listTextures()[0]!.getImage()).toEqual(image);
  expect(nodes.find((node) => node.getName() === 'spawn')!.getExtras()).toMatchObject({
    mapedit: { markerType: 'spawn', properties: { team: 'blue' } },
  });
  expect(nodes.find((node) => node.getName() === 'zone')!.getExtras()).toMatchObject({
    mapedit: { collider: { type: 'box', isTrigger: true, size: [2, 2, 2] } },
  });
  expect(
    nodes.some(
      (node) =>
        (node.getExtras().mapedit as { kind?: string })?.kind === 'terrain' && node.getMesh(),
    ),
  ).toBe(true);
  const terrainMaterials = document
    .getRoot()
    .listMaterials()
    .filter((item) => item.getName().startsWith('surface:'));
  expect(terrainMaterials.length).toBeGreaterThan(0);
  for (const item of terrainMaterials) expect(item.getMetallicFactor()).toBe(0);
});

it('rechecks physical overlap, Support and terrain even when the caller only ran the compiler', async () => {
  const models = new Map([['block', await buildModel(box([2, 2, 2]))]]),
    terrain = createTerrain(100, 100);
  await expect(
    exportMapGlb({
      compilation: compilation({
        positions: [
          [10, 10],
          [11, 10],
        ],
      }),
      models,
      terrain,
    }),
  ).rejects.toThrow('overlaps');
  await expect(
    exportMapGlb({ compilation: compilation({ height: 3 }), models, terrain }),
  ).rejects.toThrow('Support');
  await expect(
    exportMapGlb({ compilation: compilation(), models, terrain: createTerrain(100, 100, 1) }),
  ).rejects.toThrow('terrain');
});

it('rejects missing/oversized geometry and existing compiler diagnostics', async () => {
  const terrain = createTerrain(100, 100);
  await expect(
    exportMapGlb({ compilation: compilation(), models: new Map(), terrain }),
  ).rejects.toThrow('no built geometry');
  await expect(
    exportMapGlb({
      compilation: compilation(),
      models: new Map([['block', await buildModel(box([3, 2, 2]))]]),
      terrain,
    }),
  ).rejects.toThrow('exceeds');
  await expect(
    exportMapGlb({
      compilation: compilation({ positions: [[100, 100]] }),
      models: new Map([['block', await buildModel(box([2, 2, 2]))]]),
      terrain,
    }),
  ).rejects.toThrow('violations');
});

it('generates required Foundation geometry when an export caller omits generated meshes', async () => {
  const compiled = compilation({ height: 2, foundation: true, rotation: 30 });
  const bytes = await exportMapGlb({
    compilation: compiled,
    models: new Map([['block', await buildModel(box([2, 2, 2]))]]),
    terrain: createTerrain(100, 100),
  });
  const document = await new WebIO().readBinary(bytes);
  const foundation = document
    .getRoot()
    .listNodes()
    .find((node) => (node.getExtras().mapedit as { kind?: string })?.kind === 'foundation');
  expect(foundation?.getMesh()).toBeTruthy();
  expect(foundation?.getExtras()).toEqual({
    mapedit: { kind: 'foundation', owner: 'module:house_0/base', collider: { type: 'mesh' } },
  });
});
