import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { mockScene } from '@mapedit/server';
import type { SceneSnapshot } from '@mapedit/protocol';
import { montageLayout, regionOf, viewCamera } from '../src/render/views.js';
import { legendLines } from '../src/render/montage.js';

const region = { center: new Vector3(50, 0, 50), radius: 20 };
/** Normalized screen position of a map point (x right, y up, −1…1). */
const screen = (camera: ReturnType<typeof viewCamera>, point: [number, number, number]) =>
  new Vector3(...point).project(camera);

describe('render view cameras', () => {
  it('top looks straight down with north up and east to the right', () => {
    const camera = viewCamera('top', region);
    const north = screen(camera, [50, 0, 40]);
    const east = screen(camera, [60, 0, 50]);
    expect(north.y).toBeGreaterThan(0.4);
    expect(Math.abs(north.x)).toBeLessThan(1e-9);
    expect(east.x).toBeGreaterThan(0.4);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    // The whole region fits.
    expect(screen(camera, [70, 0, 70]).x).toBeLessThanOrEqual(1);
  });

  it('places angled cameras above their compass direction, looking at the center', () => {
    const expected = { ne: [1, -1], se: [1, 1], sw: [-1, 1], nw: [-1, -1] } as const;
    for (const [view, [x, z]] of Object.entries(expected)) {
      const camera = viewCamera(view as keyof typeof expected, region);
      const offset = camera.position.clone().sub(region.center);
      expect(Math.sign(offset.x), view).toBe(x);
      expect(Math.sign(offset.z), view).toBe(z);
      expect(offset.y).toBeGreaterThan(0);
      const center = screen(camera, [50, 0, 50]);
      expect(Math.abs(center.x)).toBeLessThan(1e-6);
      expect(Math.abs(center.y)).toBeLessThan(1e-6);
    }
  });

  it('fits a map box tightly in angled views without cutting a corner', () => {
    const box = new Box3(new Vector3(0, -1, 0), new Vector3(100, 5, 100));
    const loose = viewCamera('ne', { center: box.getCenter(new Vector3()), radius: 71 });
    const tight = viewCamera('ne', regionOf({}, box));
    expect(tight.position.distanceTo(box.getCenter(new Vector3()))).toBeLessThanOrEqual(
      loose.position.distanceTo(box.getCenter(new Vector3())) + 1e-6,
    );
    for (const corner of [
      [0, -1, 0],
      [100, 5, 0],
      [0, 5, 100],
      [100, -1, 100],
    ] as const) {
      const p = screen(tight, [...corner]);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it('uses the focus when one is given', () => {
    const focused = regionOf({ focus: { center: [1, 2, 3], radius: 4 } }, new Box3());
    expect(focused.center.toArray()).toEqual([1, 2, 3]);
    expect(focused.radius).toBe(4);
    expect(focused.box).toBeUndefined();
  });

  it('lays out up to three views in a row and more in two rows', () => {
    expect([1, 2, 3, 4, 5].map((n) => montageLayout(n))).toEqual([
      { columns: 1, rows: 1 },
      { columns: 2, rows: 1 },
      { columns: 3, rows: 1 },
      { columns: 2, rows: 2 },
      { columns: 3, rows: 2 },
    ]);
  });
});

describe('render legend (FE17)', () => {
  /** A scene without terrain, like a module preview. */
  const bare = (map: Partial<SceneSnapshot['map']>): SceneSnapshot => {
    const scene = mockScene();
    return { ...scene, terrain: { revision: 0, chunks: [] }, map: { ...scene.map, ...map } };
  };

  it('tells a module preview by its map kind, not by its id', () => {
    const preview = bare({ id: 'preview-1', name: 'Door', kind: 'module_preview' });
    expect(legendLines(preview, 0.5).map((line) => line.text)).toEqual([
      'Door',
      'module preview · grid lines every 0.5 m',
      'north is -Z',
    ]);
    const map = bare({ id: '__module_like', kind: 'map' });
    expect(legendLines(map, 0.5)[1]!.text).toMatch(/^map __module_like · revision /);
  });
});
