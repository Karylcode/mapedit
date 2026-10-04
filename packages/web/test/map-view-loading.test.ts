import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InstancedMesh } from 'three';
import { createServer, mockScene, type MapeditServer } from '@mapedit/server';
import type { SceneSnapshot } from '@mapedit/protocol';
import { AssetCache } from '../src/scene/assets.js';
import { MapView } from '../src/scene/map-view.js';
import { installFakeCanvas } from './fake-canvas.js';

installFakeCanvas();

let server: MapeditServer;
let glb: ArrayBuffer;

beforeAll(async () => {
  server = await createServer({ mock: true, port: 0 });
  glb = await (await fetch(`${server.url}/assets/mock/block.glb`)).arrayBuffer();
});
afterAll(() => server.close());

/** A snapshot with `types` module types, each used by `count` instances. */
function snapshot(types: string[], count = 1, revision = 0): SceneSnapshot {
  const scene = mockScene();
  scene.revision = revision;
  scene.terrain.chunks = [];
  scene.generated = [];
  scene.markers = [];
  scene.violations = [];
  const base = scene.structures[0]!;
  scene.moduleTypes = types.map((url, i) => ({
    id: `type${i}`,
    name: `Type ${i}`,
    url,
    size: [2, 2, 2],
    isFoundation: false,
    canFloat: false,
  }));
  scene.structures = types.flatMap((_, i) =>
    Array.from({ length: count }, (__, j) => ({
      ...base,
      ref: `structure:s${i}_${j}`,
      instances: [{ ...base.instances[0]!, ref: `module:s${i}_${j}/base`, moduleType: `type${i}` }],
    })),
  );
  return scene;
}

/** A fetcher whose requests finish only when the test releases them. */
function controlledFetcher() {
  const waiting = new Map<
    string,
    { resolve: (data: ArrayBuffer) => void; reject: (error: Error) => void }
  >();
  const fetcher = (url: string) =>
    new Promise<ArrayBuffer>((resolve, reject) => waiting.set(url, { resolve, reject }));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    fetcher,
    async release(url: string) {
      waiting.get(url)!.resolve(glb.slice(0));
      waiting.delete(url);
      await settle();
    },
    async fail(url: string) {
      waiting.get(url)!.reject(new Error('HTTP 503'));
      waiting.delete(url);
      await settle();
    },
  };
}

const batches = (view: MapView) =>
  view.root.getObjectByName('modules')!.children as InstancedMesh[];

describe('MapView while module models load', () => {
  it('refreshes at most once per module type as their models arrive one by one (FE1)', async () => {
    const types = Array.from({ length: 20 }, (_, i) => `/assets/fe1/type${i}.glb`);
    const network = controlledFetcher();
    const view = new MapView(new AssetCache(network.fetcher));
    let refreshes = 0;
    const original = (view as unknown as { refresh(): void }).refresh.bind(view);
    // Stop runaway cascades early so a regression fails fast instead of hanging.
    vi.spyOn(view as unknown as { refresh(): void }, 'refresh').mockImplementation(() => {
      if (++refreshes <= 500) original();
    });
    view.apply(snapshot(types));
    refreshes = 0;
    for (const url of types) await network.release(url);
    await view.settled();
    expect(refreshes).toBeLessThanOrEqual(types.length);
    expect(batches(view).filter((mesh) => mesh.count > 0)).toHaveLength(20);
  });
});
