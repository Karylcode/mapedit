import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createTerrain, encodeTerrain, parseProject, type TerrainData } from '@mapedit/core';
import { buildProject, buildFromParsed } from '../src/build-project.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), 'mapedit-build-')))
      throw new Error('Unexpected test cleanup path.');
    await rm(root, { recursive: true, force: true });
  }
});
async function write(root: string, file: string, data: string | Uint8Array) {
  const target = join(root, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}
async function fixture(
  options: {
    model?: string | null;
    properties?: string;
    terrain?: TerrainData;
    structures?: unknown[];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-build-'));
  roots.push(root);
  const files = {
    'project.yaml': 'name: Build integration\n',
    'modules/block/module.yaml': `id: block\nsize: [2, 2, 2]\n${options.properties ?? ''}`,
    'maps/test/map.yaml': 'name: Test\nsize: {x: 100, z: 100}\n',
    'maps/test/structures/buildings.yaml': JSON.stringify({
      structures: options.structures ?? [
        {
          id: 'house',
          position: [10, 10],
          modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
        },
      ],
    }),
  };
  for (const [file, data] of Object.entries(files)) await write(root, file, data);
  if (options.model !== null)
    await write(
      root,
      'modules/block/model.ts',
      options.model ?? `import {box} from '@mapedit/model';export default box([2,2,2]);`,
    );
  if (options.terrain) {
    const png = encodeTerrain(options.terrain);
    await write(root, 'maps/test/terrain/height.png', png.height);
    await write(root, 'maps/test/terrain/surface.png', png.surface);
  }
  return root;
}

describe('real model and terrain project compilation', () => {
  it('reports missing or oversized models and clears the diagnostic after repair', async () => {
    const root = await fixture({ model: null });
    const missing = await buildProject(root, 'test');
    expect(missing.scene.fileErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'modules/block/model.ts' })]),
    );
    await write(
      root,
      'modules/block/model.ts',
      `import {box} from '@mapedit/model';export default box([3,2,2]);`,
    );
    const invalid = await buildProject(root, 'test');
    expect(invalid.scene.fileErrors.some((error) => error.message.includes('exceeds'))).toBe(true);
    await write(
      root,
      'modules/block/model.ts',
      `import {box} from '@mapedit/model';export default box([2,2,2]);`,
    );
    const fixed = await buildProject(root, 'test');
    expect(fixed.scene.fileErrors).toEqual([]);
    expect(fixed.scene.violations).toEqual([]);
    expect(fixed.geometries.size).toBe(1);
  });
  it('snaps independent terrain-following Modules to their terrain location', async () => {
    const terrain = createTerrain(100, 100);
    for (let z = 0; z < 100; z++) for (let x = 15; x < 100; x++) terrain.heights[z * 100 + x] = 3;
    const root = await fixture({
      properties: 'terrainFollow: true\n',
      terrain,
      structures: [
        {
          id: 'props',
          position: [10, 10],
          modules: [
            { id: 'low', module: 'block', at: [0, 0, 0] },
            { id: 'high', module: 'block', at: [10, 0, 0] },
          ],
        },
      ],
    });
    const built = await buildProject(root, 'test');
    expect(built.scene.fileErrors).toEqual([]);
    expect(built.scene.violations).toEqual([]);
    expect(
      Object.fromEntries(
        built.compilation.instances.map((entry) => [entry.ref, entry.transform[13]]),
      ),
    ).toEqual({ 'module:props/low': 0, 'module:props/high': 3 });
    expect(built.assets.size).toBeGreaterThan(1);
  });
  it('generates real foundation extensions on sloped PNG terrain without editing terrain', async () => {
    const terrain = createTerrain(100, 100, 1);
    for (let z = 0; z < 100; z++) for (let x = 12; x < 100; x++) terrain.heights[z * 100 + x] = 0;
    const root = await fixture({
      properties: 'isFoundation: true\nfoundationStyle: skirt\n',
      terrain,
      structures: [
        {
          id: 'house',
          position: [10, 10],
          height: 1,
          rotation: 30,
          modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
        },
      ],
    });
    const before = await readFile(join(root, 'maps/test/terrain/height.png'));
    const built = await buildProject(root, 'test');
    expect(built.scene.fileErrors).toEqual([]);
    expect(built.scene.violations).toEqual([]);
    expect(built.generated).toHaveLength(1);
    expect(built.generated[0]!.geometry.bounds.min[1]).toBeLessThan(1);
    expect(built.scene.generated[0]!.owner).toBe('module:house/base');
    expect(built.assets.has(built.scene.generated[0]!.url)).toBe(true);
    expect(await readFile(join(root, 'maps/test/terrain/height.png'))).toEqual(before);
  });
  it('rejects ordinary terrain penetration while allowing foundations to be buried', async () => {
    const terrain = createTerrain(100, 100, 1);
    const structures = [
      {
        id: 'house',
        position: [10, 10],
        height: 0,
        modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
      },
    ];
    const root = await fixture({ terrain, structures });
    const ordinary = await buildProject(root, 'test');
    expect(
      ordinary.scene.violations.some(
        (violation) => violation.kind === 'overlap' && violation.params.target === 'terrain',
      ),
    ).toBe(true);
    await write(
      root,
      'modules/block/module.yaml',
      'id: block\nsize: [2, 2, 2]\nisFoundation: true\n',
    );
    const foundation = await buildProject(root, 'test');
    expect(foundation.scene.violations).toEqual([]);
  });
  it('does not let mutations leak between content-identical terrain cache entries', async () => {
    const root = await fixture();
    const first = await buildProject(root, 'test');
    first.terrain.heights[0] = 15;
    const second = await buildProject(root, 'test');
    expect(second.terrain.heights[0]).toBe(0);
  });
  it('runs genuine warm previews for a 30-Structure village within 30 ms', async () => {
    const structures = Array.from({ length: 30 }, (_, index) => ({
      id: `house_${index}`,
      position: [5 + (index % 6) * 10, 5 + Math.floor(index / 6) * 10],
      modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
    }));
    const root = await fixture({ structures });
    const built = await buildProject(root, 'test');
    const files = { ...built.parsed.files };
    structures[0]!.position = [7, 5];
    files['maps/test/structures/buildings.yaml'] = JSON.stringify({ structures });
    const parsed = parseProject(files);
    await buildFromParsed(parsed, 'test', 2, built);
    const durations: number[] = [];
    for (let index = 0; index < 9; index++) {
      const start = performance.now();
      const preview = await buildFromParsed(parsed, 'test', index + 3, built);
      durations.push(performance.now() - start);
      expect(preview.scene.violations).toEqual([]);
    }
    expect(durations.sort((a, b) => a - b)[4]).toBeLessThan(30);
    expect(built.compilation.instances[0]!.transform[12]).toBe(5);
  });
});
