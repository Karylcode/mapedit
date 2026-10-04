import { decode, encode } from 'fast-png';
import { Document, WebIO, type Mesh } from '@gltf-transform/core';
import type { Vec3 } from '@mapedit/protocol';

export interface TerrainData {
  width: number;
  depth: number;
  heights: Float32Array;
  surfaces: Uint8Array;
}
export const SURFACES = ['grass', 'dirt', 'gravel', 'stone', 'sand'] as const;
export type Surface = (typeof SURFACES)[number];
export type TerrainRegion =
  | { kind: 'circle'; center: [number, number]; radius: number }
  | { kind: 'rectangle'; min: [number, number]; max: [number, number] }
  | { kind: 'path'; points: [number, number][]; width: number };
export type TerrainCommand =
  | { operation: 'raise' | 'lower'; region: TerrainRegion; amount: number }
  | { operation: 'flatten'; region: TerrainRegion; height?: number }
  | { operation: 'set_height'; region: TerrainRegion; height: number }
  | { operation: 'paint'; region: TerrainRegion; surface: Surface }
  | { operation: 'mountain'; region: TerrainRegion; height: number };
const quantize = (value: number) => Math.round(value * 2) / 2;
const inHeightRange = (value: number) =>
  Number.isFinite(value) && value >= -16384 && value <= 16383.5;

export function createTerrain(width: number, depth: number, height = 0): TerrainData {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(depth) ||
    width < 1 ||
    depth < 1 ||
    width > 1000 ||
    depth > 1000
  ) {
    throw new Error('Terrain dimensions must be integers between 1 and 1000 metres.');
  }
  if (!inHeightRange(height) || height !== quantize(height))
    throw new Error('Terrain height must be a 0.5 metre step in the signed 16-bit range.');
  return {
    width,
    depth,
    heights: new Float32Array(width * depth).fill(height),
    surfaces: new Uint8Array(width * depth),
  };
}

/** PNG rows increase toward +Z (south). Height sample = metres * 2 + 32768. */
export function encodeTerrain(terrain: TerrainData): { height: Uint8Array; surface: Uint8Array } {
  const heights = Uint16Array.from(terrain.heights, (height) => {
    if (!inHeightRange(height) || quantize(height) !== height)
      throw new Error('Invalid terrain height.');
    return height * 2 + 32768;
  });
  return {
    height: encode({
      width: terrain.width,
      height: terrain.depth,
      data: heights,
      channels: 1,
      depth: 16,
    }),
    surface: encode({
      width: terrain.width,
      height: terrain.depth,
      data: terrain.surfaces,
      channels: 1,
      depth: 8,
    }),
  };
}

export function decodeTerrain(
  heightPng: Uint8Array,
  surfacePng: Uint8Array,
  expected?: { x: number; z: number },
): TerrainData {
  const h = decode(heightPng, { checkCrc: true });
  const s = decode(surfacePng, { checkCrc: true });
  if (h.depth !== 16 || h.channels !== 1) throw new Error('height.png must be 16-bit grayscale.');
  if (s.depth !== 8 || s.channels !== 1 || s.palette)
    throw new Error('surface.png must be 8-bit grayscale surface IDs.');
  if (h.width !== s.width || h.height !== s.height)
    throw new Error('Terrain PNG dimensions must match.');
  if (expected && (h.width !== expected.x || h.height !== expected.z))
    throw new Error('Terrain PNG dimensions must equal the map size in metres.');
  const result = createTerrain(h.width, h.height);
  result.heights = Float32Array.from(h.data, (value) => (value - 32768) / 2);
  result.surfaces = Uint8Array.from(s.data);
  if (result.surfaces.some((value) => value >= SURFACES.length))
    throw new Error('surface.png contains an unknown surface ID (valid: 0–4).');
  return result;
}

function tileHeight(t: TerrainData, x: number, z: number): number {
  return t.heights[
    Math.max(0, Math.min(t.depth - 1, z)) * t.width + Math.max(0, Math.min(t.width - 1, x))
  ]!;
}

/** Average nearby gentle steps; keep each side of a cliff at its own elevation. */
function cornerHeight(t: TerrainData, x: number, z: number, cx: number, cz: number): number {
  const base = tileHeight(t, x, z);
  let sum = 0;
  let count = 0;
  for (let dz = -1; dz <= 0; dz++)
    for (let dx = -1; dx <= 0; dx++) {
      const h = tileHeight(t, cx + dx, cz + dz);
      if (Math.abs(h - base) <= 1) {
        sum += h;
        count++;
      }
    }
  return count ? sum / count : base;
}

export function terrainTileCorners(t: TerrainData, x: number, z: number): [Vec3, Vec3, Vec3, Vec3] {
  return [
    [x, cornerHeight(t, x, z, x, z), z],
    [x, cornerHeight(t, x, z, x, z + 1), z + 1],
    [x + 1, cornerHeight(t, x, z, x + 1, z + 1), z + 1],
    [x + 1, cornerHeight(t, x, z, x + 1, z), z],
  ];
}

export function terrainHeightAt(t: TerrainData, x: number, z: number): number {
  x = Math.max(0, Math.min(t.width, x));
  z = Math.max(0, Math.min(t.depth, z));
  const tx = Math.min(t.width - 1, Math.floor(x));
  const tz = Math.min(t.depth - 1, Math.floor(z));
  const [a, b, c, d] = terrainTileCorners(t, tx, tz);
  const u = x - tx,
    v = z - tz;
  return v >= u
    ? a[1] * (1 - v) + b[1] * (v - u) + c[1] * u
    : a[1] * (1 - u) + c[1] * v + d[1] * (u - v);
}

export function terrainSurfaceAt(t: TerrainData, x: number, z: number): Surface {
  const index =
    Math.max(0, Math.min(t.depth - 1, Math.floor(z))) * t.width +
    Math.max(0, Math.min(t.width - 1, Math.floor(x)));
  return SURFACES[t.surfaces[index]!]!;
}

export function* terrainTriangles(
  t: TerrainData,
  bounds?: { min: Vec3; max: Vec3 },
): Generator<[Vec3, Vec3, Vec3]> {
  const x0 = Math.max(0, Math.floor(bounds?.min[0] ?? 0)),
    z0 = Math.max(0, Math.floor(bounds?.min[2] ?? 0));
  const x1 = Math.min(t.width, Math.ceil(bounds?.max[0] ?? t.width)),
    z1 = Math.min(t.depth, Math.ceil(bounds?.max[2] ?? t.depth));
  for (let z = z0; z < z1; z++)
    for (let x = x0; x < x1; x++) {
      const [a, b, c, d] = terrainTileCorners(t, x, z);
      yield [a, b, c];
      yield [a, c, d];
    }
}

function regionWeight(region: TerrainRegion, x: number, z: number): number {
  if (region.kind === 'circle')
    return Math.max(0, 1 - Math.hypot(x - region.center[0], z - region.center[1]) / region.radius);
  if (region.kind === 'rectangle') {
    if (x < region.min[0] || z < region.min[1] || x > region.max[0] || z > region.max[1]) return 0;
    return Math.max(
      Number.EPSILON,
      Math.min(
        1,
        2 *
          Math.min(
            (x - region.min[0]) / (region.max[0] - region.min[0]),
            (region.max[0] - x) / (region.max[0] - region.min[0]),
            (z - region.min[1]) / (region.max[1] - region.min[1]),
            (region.max[1] - z) / (region.max[1] - region.min[1]),
          ),
      ),
    );
  }
  let distance = Infinity;
  for (let i = 1; i < region.points.length; i++) {
    const a = region.points[i - 1]!,
      b = region.points[i]!;
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    const f = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    );
    distance = Math.min(distance, Math.hypot(x - a[0] - f * dx, z - a[1] - f * dz));
  }
  return Math.max(0, 1 - distance / (region.width / 2));
}

function validateRegion(region: TerrainRegion): void {
  const point = (p: number[]) => p.length === 2 && p.every(Number.isFinite);
  const valid =
    region.kind === 'circle'
      ? point(region.center) && Number.isFinite(region.radius) && region.radius > 0
      : region.kind === 'rectangle'
        ? point(region.min) &&
          point(region.max) &&
          region.max[0] > region.min[0] &&
          region.max[1] > region.min[1]
        : region.kind === 'path' &&
          region.points.length >= 2 &&
          region.points.every(point) &&
          Number.isFinite(region.width) &&
          region.width > 0;
  if (!valid)
    throw new Error('Invalid terrain region. Use finite metre coordinates and a positive area.');
}

/** Pure operation: the original arrays are retained for undo/history. */
export function applyTerrainCommand(t: TerrainData, command: TerrainCommand): TerrainData {
  validateRegion(command.region);
  const selected: [number, number][] = [];
  for (let z = 0; z < t.depth; z++)
    for (let x = 0; x < t.width; x++) {
      const weight = regionWeight(command.region, x + 0.5, z + 0.5);
      if (weight > 0) selected.push([z * t.width + x, weight]);
    }
  const result = { ...t, heights: t.heights.slice(), surfaces: t.surfaces.slice() };
  if (command.operation === 'paint') {
    const surface = SURFACES.indexOf(command.surface);
    if (surface < 0) throw new Error('Unknown surface.');
    for (const [index] of selected) result.surfaces[index] = surface;
    return result;
  }
  const height =
    'amount' in command
      ? command.amount
      : command.operation === 'flatten'
        ? (command.height ??
          quantize(selected.reduce((sum, [i]) => sum + t.heights[i]!, 0) / (selected.length || 1)))
        : command.height;
  if (!inHeightRange(height) || quantize(height) !== height)
    throw new Error('Terrain operations require 0.5 metre height steps.');
  if (
    (command.operation === 'raise' ||
      command.operation === 'lower' ||
      command.operation === 'mountain') &&
    height < 0
  )
    throw new Error('Amount must be non-negative.');
  for (const [index, weight] of selected) {
    const original = t.heights[index]!;
    const next =
      command.operation === 'raise'
        ? original + height
        : command.operation === 'lower'
          ? original - height
          : command.operation === 'mountain'
            ? original + quantize(height * weight)
            : height;
    if (!inHeightRange(next))
      throw new Error('Terrain operation exceeds the signed 16-bit height range.');
    result.heights[index] = next;
  }
  return result;
}

export interface TerrainChunkMesh {
  cx: number;
  cz: number;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  surfaces: Map<number, Uint32Array>;
}

/** Bounded memory: callers can encode/write each chunk before asking for the next. */
export function* terrainChunks(t: TerrainData, chunkSize = 32): Generator<TerrainChunkMesh> {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 128)
    throw new Error('Chunk size must be 1–128 metres.');
  for (let cz = 0; cz < Math.ceil(t.depth / chunkSize); cz++)
    for (let cx = 0; cx < Math.ceil(t.width / chunkSize); cx++) {
      const positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [];
      const surfaces = new Map<number, number[]>();
      const triangle = (a: Vec3, b: Vec3, c: Vec3, surface: number) => {
        const ab = b.map((v, i) => v - a[i]!),
          ac = c.map((v, i) => v - a[i]!);
        const n = [
          ab[1]! * ac[2]! - ab[2]! * ac[1]!,
          ab[2]! * ac[0]! - ab[0]! * ac[2]!,
          ab[0]! * ac[1]! - ab[1]! * ac[0]!,
        ];
        const length = Math.hypot(...n) || 1;
        const start = positions.length / 3;
        const indices = surfaces.get(surface) ?? [];
        indices.push(start, start + 1, start + 2);
        surfaces.set(surface, indices);
        for (const p of [a, b, c]) {
          positions.push(...p);
          normals.push(...n.map((v) => v / length));
          uvs.push(p[0], p[2]);
        }
      };
      const seam = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, surface: number) => {
        if (Math.abs(a[1] - d[1]) + Math.abs(b[1] - c[1]) > 1e-6) {
          triangle(a, b, c, surface);
          triangle(a, c, d, surface);
        }
      };
      for (let z = cz * chunkSize; z < Math.min(t.depth, (cz + 1) * chunkSize); z++)
        for (let x = cx * chunkSize; x < Math.min(t.width, (cx + 1) * chunkSize); x++) {
          const [a, b, c, d] = terrainTileCorners(t, x, z);
          const surface = t.surfaces[z * t.width + x]!;
          triangle(a, b, c, surface);
          triangle(a, c, d, surface);
          if (x + 1 < t.width) {
            const [e, f] = terrainTileCorners(t, x + 1, z);
            seam(d, c, f, e, surface);
          }
          if (z + 1 < t.depth) {
            const [e, , , h] = terrainTileCorners(t, x, z + 1);
            seam(c, b, e, h, surface);
          }
        }
      yield {
        cx,
        cz,
        positions: new Float32Array(positions),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        surfaces: new Map([...surfaces].map(([id, indices]) => [id, new Uint32Array(indices)])),
      };
    }
}

export function appendTerrainChunk(doc: Document, chunk: TerrainChunkMesh): Mesh {
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const accessor = (type: 'VEC3' | 'VEC2', array: Float32Array) =>
    doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const position = accessor('VEC3', chunk.positions),
    normal = accessor('VEC3', chunk.normals),
    uv = accessor('VEC2', chunk.uvs);
  const mesh = doc.createMesh(`terrain_${chunk.cx}_${chunk.cz}`);
  const colors: [number, number, number, number][] = [
    [0.24, 0.38, 0.12, 1],
    [0.31, 0.19, 0.09, 1],
    [0.4, 0.39, 0.36, 1],
    [0.48, 0.48, 0.46, 1],
    [0.7, 0.59, 0.35, 1],
  ];
  for (const [surface, indices] of chunk.surfaces) {
    const name = `surface:${SURFACES[surface]}`;
    const material =
      doc
        .getRoot()
        .listMaterials()
        .find((item) => item.getName() === name) ??
      doc
        .createMaterial(name)
        .setBaseColorFactor(colors[surface]!)
        .setMetallicFactor(0)
        .setRoughnessFactor(1)
        .setDoubleSided(true);
    mesh.addPrimitive(
      doc
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setAttribute('TEXCOORD_0', uv)
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
        .setMaterial(material),
    );
  }
  return mesh;
}

export async function terrainChunkGlb(chunk: TerrainChunkMesh): Promise<Uint8Array> {
  const doc = new Document(),
    mesh = appendTerrainChunk(doc, chunk);
  const node = doc
    .createNode(mesh.getName())
    .setMesh(mesh)
    .setExtras({ mapedit: { kind: 'terrain', collider: { type: 'mesh' } } });
  doc.createScene().addChild(node);
  return new WebIO().writeBinary(doc);
}
