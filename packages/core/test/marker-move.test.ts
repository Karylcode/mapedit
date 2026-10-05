import { expect, it } from 'vitest';
import type { MarkerView, Vec3 } from '@mapedit/protocol';
import { stringify } from 'yaml';
import { applySourceEdit, normalizeEdit, parseProject } from '../src/format.js';

const markerFile = 'maps/village/markers.yaml';
const terrainHeight = (x: number): number => (x >= 30 ? 6 : x >= 20 ? 3 : 1);
function files(shape: MarkerView['shape']): Record<string, string> {
  return {
    'project.yaml': 'name: Marker movement\n',
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    [markerFile]: stringify({
      markers: [{ id: 'target', type: shape.kind === 'box' ? 'trigger' : 'spawn', shape }],
    }),
  };
}
function move(input: Record<string, string>, position: Vec3, height = terrainHeight) {
  const parsed = parseProject(input);
  expect(parsed.fileErrors).toEqual([]);
  const edit = normalizeEdit(
    parsed,
    'village',
    { kind: 'move', ref: 'marker:target', position, rotation: 31 },
    height,
  );
  const updated = { ...input, ...applySourceEdit(parsed, 'village', edit) };
  const after = parseProject(updated);
  expect(after.fileErrors).toEqual([]);
  return { edit, updated, marker: after.maps.village!.markers[0]! };
}

it('F2 keeps a ground-touching box bottom on higher terrain after a move', () => {
  const input = files({ kind: 'box', center: [10, 2, 10], size: [2, 2, 2], rotation: 0 });
  const { edit, marker } = move(input, [20.1, -99, 10.1]);
  expect(edit).toMatchObject({ position: [20, 4, 10], rotation: 30 });
  expect(marker.shape).toMatchObject({ kind: 'box', center: [20, 4, 10] });
  if (marker.shape.kind !== 'box') throw new Error('Expected a box marker.');
  expect(marker.shape.center[1] - marker.shape.size[1] / 2).toBe(terrainHeight(20));
});

it('F2 preserves two meters of clearance below an elevated box', () => {
  const input = files({ kind: 'box', center: [10, 4, 10], size: [2, 2, 2], rotation: 0 });
  const { marker } = move(input, [20, 0, 10]);
  expect(marker.shape).toMatchObject({ kind: 'box', center: [20, 6, 10] });
  if (marker.shape.kind !== 'box') throw new Error('Expected a box marker.');
  expect(marker.shape.center[1] - marker.shape.size[1] / 2 - terrainHeight(20)).toBe(2);
});

it('F2 preserves a point marker height above the old terrain', () => {
  const input = files({ kind: 'point', position: [10, 3, 10], rotation: 0 });
  const { marker } = move(input, [20, 0, 10]);
  expect(marker.shape).toMatchObject({ kind: 'point', position: [20, 5, 10] });
});

it('F2 repeated moves preserve box clearance from the latest saved coordinates', () => {
  const input = files({ kind: 'box', center: [10, 2, 10], size: [2, 2, 2], rotation: 0 });
  const first = move(input, [20, 0, 10]);
  const second = move(first.updated, [30, 0, 10]);
  expect(second.marker.shape).toMatchObject({ kind: 'box', center: [30, 7, 10] });
});

it('F2 quantizes the terrain-relative height to the authoring grid on a slope', () => {
  const input = files({ kind: 'point', position: [10, 3, 10], rotation: 0 });
  const { marker } = move(input, [20, 0, 10], (x) => x / 30);
  expect(marker.shape).toMatchObject({ kind: 'point', position: [20, 3.5, 10] });
});
