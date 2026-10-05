import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import type { SceneSnapshot } from '@mapedit/protocol';
import { SnapshotIndex, violatingRefs } from '../src/scene/snapshot-index.js';
import { MapView } from '../src/scene/map-view.js';
import { AssetCache } from '../src/scene/assets.js';
import { objectName, wholeObjects } from '../src/editor/describe.js';
import { installFakeCanvas } from './fake-canvas.js';

installFakeCanvas();

/**
 * Structure B is attached to structure A through sockets. The compiler draws
 * the merged result as A, but B's modules keep their `module:B/...` refs, and
 * a violation about the attachment names `structure:B` without a location.
 */
function mergedScene(): SceneSnapshot {
  const scene = mockScene();
  const house = scene.structures[0]!;
  const shed = scene.structures.find((s) => s.ref === 'structure:off_grid')!;
  house.instances.push({ ...shed.instances[0]!, ref: 'module:shed/base' });
  scene.structures = [house];
  scene.violations = [
    {
      id: 'bad_rotation:[["structure:shed"],"structure_attachment"]',
      kind: 'bad_rotation',
      message: 'Attached structure "shed" turns 45 degrees.',
      params: { field: 'structure_attachment', rotation: 45, step: 90, nearest: 0 },
      refs: ['structure:shed'],
    },
  ];
  scene.markers = [];
  scene.generated = [];
  return scene;
}

describe('structures attached to another structure (FE12)', () => {
  it('maps the attached structure to its own modules inside the merged one', () => {
    const index = new SnapshotIndex(mergedScene());
    expect(index.has('structure:shed')).toBe(true);
    expect(index.instancesOf('structure:shed')).toEqual(['module:shed/base']);
    expect(index.structureOf('structure:shed')?.ref).toBe('structure:house');
    expect([...violatingRefs(index, index.scene.violations)]).toEqual(['module:shed/base']);
    expect(objectName('structure:shed', index)).toBe('shed');
    expect(wholeObjects(['structure:shed'], index)).toEqual(['structure:house']);
  });

  it('marks it red and gives it bounds to fly to and outline', () => {
    const view = new MapView(new AssetCache(() => new Promise<ArrayBuffer>(() => {})));
    view.apply(mergedScene());
    expect(view.violationMarks.glass.count).toBe(1);
    const bounds = view.boundsOf('structure:shed');
    expect(bounds).toBeDefined();
    expect(bounds!.min.x).toBeCloseTo(60.25);
    view.setOutlines('selection', ['structure:shed']);
    expect(view.outlines.selection.lines.visible).toBe(true);
  });
});
