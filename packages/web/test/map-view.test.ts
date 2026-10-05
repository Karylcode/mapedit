import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InstancedMesh, Mesh, Raycaster, Vector3 } from 'three';
import { createServer, mockScene, type MapeditServer } from '@mapedit/server';
import type { SceneSnapshot } from '@mapedit/protocol';
import { AssetCache } from '../src/scene/assets.js';
import { MapView } from '../src/scene/map-view.js';
import { installFakeCanvas } from './fake-canvas.js';

installFakeCanvas();

let server: MapeditServer;
const fetched: string[] = [];
const fetcher = async (url: string) => {
  fetched.push(url);
  const response = await fetch(server.url + url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
};

beforeAll(async () => {
  server = await createServer({ mock: true, port: 0 });
});
afterAll(() => server.close());

function meshes(view: MapView) {
  const instanced: InstancedMesh[] = [];
  const plain: Mesh[] = [];
  view.root.traverse((object) => {
    if (object instanceof InstancedMesh) instanced.push(object);
    else if (object instanceof Mesh) plain.push(object);
  });
  return { instanced, plain };
}

const ray = (from: [number, number, number], to: [number, number, number]) => {
  const origin = new Vector3(...from);
  return new Raycaster(origin, new Vector3(...to).sub(origin).normalize());
};

describe('MapView with the mock snapshot', () => {
  it('draws terrain, instanced modules, placeholders, foundation extensions, markers and flags', async () => {
    fetched.length = 0;
    const view = new MapView(new AssetCache(fetcher));
    const scene = mockScene();
    view.apply(scene);
    await view.settled();
    expect(view.progress()).toEqual({ loaded: 4, total: 4 });
    expect(new Set(fetched)).toEqual(
      new Set([
        '/assets/mock/terrain.glb',
        '/assets/mock/block.glb',
        '/assets/mock/foundation.glb',
        '/assets/mock/foundation-extension.glb',
      ]),
    );
    const { instanced } = meshes(view);
    const byType = Object.fromEntries(
      instanced.filter((m) => m.name).map((m) => [m.name, m.count]),
    );
    // Nine block structures, one foundation, one unknown type drawn as a placeholder.
    expect(byType).toEqual({ block: 9, foundation: 1, missing_block: 1 });
    expect(view.violationMarks.flags.children).toHaveLength(scene.violations.length);
    expect(view.violationMarks.glass.count).toBe(9);
    // Every module of the eight violating structures, plus the zone marker is clean.
    expect(view.screenSprites()).toHaveLength(scene.violations.length + scene.markers.length);
  });

  it('picks modules by instance, generated meshes by owner, markers, and the ground', async () => {
    const view = new MapView(new AssetCache(fetcher));
    view.apply(mockScene());
    await view.settled();
    view.root.updateMatrixWorld(true);
    expect(view.pick(ray([11, 10, 11], [11, 0, 11]))?.ref).toBe('module:house/base');
    expect(view.pick(ray([21, 10, 21], [21, 0, 21]))?.ref).toBe('module:raised_foundation/base');
    // Below the raised foundation only its generated extension is hit.
    expect(view.pick(ray([10, 0.5, 21], [30, 0.5, 21]))?.ref).toBe('module:raised_foundation/base');
    expect(view.pick(ray([5, 5, 5], [5, 0, 5]))?.ref).toBe('marker:spawn');
    expect(view.pick(ray([10, 10, 5], [10, 0, 5]))?.ref).toBe('marker:zone');
    expect(view.pick(ray([80, 10, 80], [80, 0, 80]))).toBeUndefined();
    const ground = view.groundPoint(ray([80, 10, 80], [80, 0, 80]));
    expect(ground?.toArray().map((n) => Math.round(n * 100) / 100)).toEqual([80, 0, 80]);
  });

  it('reloads only what changed and frees assets no snapshot uses', async () => {
    const assets = new AssetCache(fetcher);
    const view = new MapView(assets);
    const first = mockScene();
    view.apply(first);
    await view.settled();
    fetched.length = 0;
    const moved: SceneSnapshot = structuredClone(first);
    moved.revision = 1;
    moved.structures[0]!.instances[0]!.transform[12] = 30;
    moved.generated = [];
    view.apply(moved);
    await view.settled();
    expect(fetched).toEqual([]);
    const house = meshes(view).instanced.find((m) => m.name === 'block')!;
    const matrix = new Float32Array(house.instanceMatrix.array.buffer, 0, 16);
    expect(matrix[12]).toBe(30);
    await Promise.resolve();
    expect(assets.get('/assets/mock/foundation-extension.glb')).toBeUndefined();
    expect(assets.get('/assets/mock/block.glb')).toBeDefined();
  });

  it('outlines a structure with one box in its own frame and reports bounds', async () => {
    const view = new MapView(new AssetCache(fetcher));
    view.apply(mockScene());
    await view.settled();
    const [box] = view.boxesFor('structure:bad_rotation');
    expect(box!.max.distanceTo(new Vector3(2, 2, 2))).toBeLessThan(1e-9);
    expect(box!.min.length()).toBeLessThan(1e-9);
    const bounds = view.boundsOf('structure:house')!;
    expect(bounds.min.toArray()).toEqual([10, 0, 10]);
    expect(bounds.max.toArray()).toEqual([12, 2, 12]);
    expect(view.boundsOf('marker:zone')!.getSize(new Vector3()).toArray()).toEqual([4, 2, 4]);
    expect(view.boxesFor('structure:nowhere')).toEqual([]);
  });

  it('clears the previous map when a different map arrives', async () => {
    const view = new MapView(new AssetCache(fetcher));
    view.apply(mockScene());
    await view.settled();
    const other = mockScene();
    other.map.id = 'other';
    other.structures = [];
    other.markers = [];
    other.generated = [];
    other.violations = [];
    view.apply(other);
    expect(meshes(view).instanced.filter((m) => m.name)).toEqual([]);
    expect(view.violationMarks.flags.children).toHaveLength(0);
  });

  it('marks an estimated overlap apart from certain violations (FE26)', async () => {
    const view = new MapView(new AssetCache(fetcher));
    const scene = mockScene();
    view.apply(scene);
    await view.settled();
    const certainBoxes = view.violationMarks.glass.count;
    const overlap = scene.violations.find((v) => v.kind === 'overlap')!;
    overlap.params = { ...overlap.params, estimated: true };
    view.apply({ ...scene, revision: scene.revision + 1 });
    const marks = view.violationMarks;
    // Its two modules leave the red glass for a dashed outline of their own.
    expect(marks.glass.count).toBe(certainBoxes - 2);
    expect(marks.estimatedLines.visible).toBe(true);
    expect(marks.estimatedLines.material.dashed).toBe(true);
    expect(marks.estimatedLines.geometry.instanceCount).toBe(2 * 12);
    const flags = marks.flags.children.map((flag) => flag.userData);
    expect(flags.filter((flag) => flag.estimated).map((flag) => flag.violation)).toEqual([
      overlap.id,
    ]);
  });

  it('singles out a violation without redrawing modules or markers (FE23)', async () => {
    const view = new MapView(new AssetCache(fetcher));
    const scene = mockScene();
    view.apply(scene);
    await view.settled();
    const parts = view as unknown as {
      modules: { update(): void };
      markers: { update(): void };
    };
    const modules = vi.spyOn(parts.modules, 'update');
    const markers = vi.spyOn(parts.markers, 'update');
    const overlap = scene.violations.find((v) => v.kind === 'overlap')!;
    view.focusViolation(overlap.id);
    expect(view.outlines.focus.refs).toEqual(overlap.refs);
    view.focusViolation(undefined);
    expect(view.outlines.focus.refs).toEqual([]);
    expect(modules).not.toHaveBeenCalled();
    expect(markers).not.toHaveBeenCalled();
  });
});
