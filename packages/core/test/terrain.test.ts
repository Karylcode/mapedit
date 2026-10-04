import { describe, expect, it } from 'vitest';
import { WebIO } from '@gltf-transform/core';
import {
  applyTerrainCommand,
  createTerrain,
  decodeTerrain,
  encodeTerrain,
  terrainChunks,
  terrainChunkGlb,
  terrainHeightAt,
  terrainSurfaceAt,
  terrainTriangles,
} from '../src/terrain.js';

describe('terrain PNG authoring', () => {
  it('round trips signed 16-bit heights exactly and rejects mismatched maps', () => {
    const terrain = createTerrain(4, 3);
    terrain.heights.set([-16384, -0.5, 0, 0.5, 127.5, 128, 256, 16383.5]);
    terrain.surfaces.set([0, 1, 2, 3, 4]);
    const png = encodeTerrain(terrain);
    const restored = decodeTerrain(png.height, png.surface, { x: 4, z: 3 });
    expect(restored.heights).toEqual(terrain.heights);
    expect(restored.surfaces).toEqual(terrain.surfaces);
    expect(() => decodeTerrain(png.height, png.surface, { x: 5, z: 3 })).toThrow('dimensions');
    expect(() => decodeTerrain(png.surface, png.surface)).toThrow('16-bit');
  });
  it('raises, lowers, flattens, sets height, paints paths and piles mountains without mutating its input', () => {
    const original = createTerrain(10, 10);
    const circle = { kind: 'circle' as const, center: [5, 5] as [number, number], radius: 3 };
    let t = applyTerrainCommand(original, { operation: 'raise', region: circle, amount: 2 });
    expect(t.heights[55]).toBe(2);
    expect(original.heights[55]).toBe(0);
    t = applyTerrainCommand(t, { operation: 'lower', region: circle, amount: 0.5 });
    expect(t.heights[55]).toBe(1.5);
    t = applyTerrainCommand(t, {
      operation: 'set_height',
      region: { kind: 'rectangle', min: [2, 2], max: [8, 8] },
      height: 3,
    });
    expect(t.heights[55]).toBe(3);
    t = applyTerrainCommand(t, { operation: 'flatten', region: circle });
    expect(t.heights[55]).toBe(3);
    t = applyTerrainCommand(t, { operation: 'flatten', region: circle, height: 0.5 });
    expect(t.heights[55]).toBe(0.5);
    t = applyTerrainCommand(t, {
      operation: 'paint',
      region: {
        kind: 'path',
        points: [
          [1, 5],
          [9, 5],
        ],
        width: 2,
      },
      surface: 'gravel',
    });
    expect(terrainSurfaceAt(t, 5, 5)).toBe('gravel');
    t = applyTerrainCommand(t, { operation: 'mountain', region: circle, height: 5 });
    expect(t.heights[55]).toBeGreaterThan(t.heights[53]!);
    expect([...t.heights].every((h) => Number.isInteger(h * 2))).toBe(true);
    expect(() =>
      applyTerrainCommand(t, { operation: 'raise', region: circle, amount: 0.1 }),
    ).toThrow('0.5');
    expect(() =>
      applyTerrainCommand(t, { operation: 'raise', region: { ...circle, radius: 0 }, amount: 1 }),
    ).toThrow('region');
  });
});

describe('terrain geometry', () => {
  it('interpolates gentle slopes, closes cliff seams and supplies exact collision triangles', async () => {
    const t = createTerrain(2, 1);
    t.heights[1] = 0.5;
    expect(terrainHeightAt(t, 1, 0.5)).toBe(0.25);
    const triangles = [...terrainTriangles(t)];
    expect(triangles).toHaveLength(4);
    expect(triangles[0]![2][1]).toBe(0.25);
    t.heights[1] = 4;
    expect(terrainHeightAt(t, 0.5, 0.5)).toBe(0);
    expect(terrainHeightAt(t, 1.5, 0.5)).toBe(4);
    const chunk = [...terrainChunks(t)][0]!;
    expect(chunk.positions.length / 9).toBe(6); // four surface triangles, two cliff triangles
    const glb = await terrainChunkGlb(chunk);
    const doc = await new WebIO().readBinary(glb);
    expect(doc.getRoot().listMeshes()).toHaveLength(1);
    expect(doc.getRoot().listNodes()[0]!.getExtras()).toMatchObject({
      mapedit: { collider: { type: 'mesh' } },
    });
  });
  it('streams every mesh of a 1000 by 1000 metre map with bounded chunk size', async () => {
    const t = createTerrain(1000, 1000);
    let chunks = 0,
      triangles = 0,
      bytes = 0;
    for (const chunk of terrainChunks(t)) {
      chunks++;
      triangles += chunk.positions.length / 9;
      expect(chunk.positions.length).toBeLessThanOrEqual(32 * 32 * 18);
      // Encode the whole map: validates chunk meshes and indices at every boundary.
      bytes += (await terrainChunkGlb(chunk)).byteLength;
    }
    expect(chunks).toBe(1024);
    expect(triangles).toBe(2_000_000);
    expect(bytes).toBeGreaterThan(1_000_000);
  }, 120000);
});

describe('terrain chunk materials', () => {
  it('uses non-metallic materials for every Surface in a chunk GLB', async () => {
    const terrain = createTerrain(10, 10);
    for (let index = 0; index < terrain.surfaces.length; index++)
      terrain.surfaces[index] = index % 5;
    const io = new WebIO();
    for (const chunk of terrainChunks(terrain)) {
      const document = await io.readBinary(await terrainChunkGlb(chunk));
      const materials = document.getRoot().listMaterials();
      expect(materials.map((material) => material.getName()).sort()).toEqual([
        'surface:dirt',
        'surface:grass',
        'surface:gravel',
        'surface:sand',
        'surface:stone',
      ]);
      // glTF defaults metallicFactor to 1, which renders terrain as polished metal.
      for (const material of materials) expect(material.getMetallicFactor()).toBe(0);
    }
  });
});
