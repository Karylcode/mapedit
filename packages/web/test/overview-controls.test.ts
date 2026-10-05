import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { OverviewCamera } from '../src/scene/overview-camera.js';
import { OverviewControls } from '../src/scene/overview-controls.js';

/** Flat ground at y = 0 everywhere on a 100 × 100 m map. */
const flat = {
  groundPoint: (raycaster: Raycaster) =>
    raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3()) ?? undefined,
  heightAt: () => 0,
};

function setup() {
  const overview = new OverviewCamera();
  overview.setMap({ x: 100, z: 100 });
  overview.frameMap(40, 1.5);
  const camera = new PerspectiveCamera(40, 1.5);
  const controls = new OverviewControls(overview, camera, flat);
  return { overview, camera, controls };
}

/** Where a screen point looks on the ground. */
function groundUnder(camera: PerspectiveCamera, overview: OverviewCamera, pointer: Vector2) {
  overview.apply(camera);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(pointer, camera);
  return flat.groundPoint(raycaster)!;
}

describe('OverviewControls', () => {
  it('orbits so the map follows the pointer and tilts within limits', () => {
    const { overview, controls } = setup();
    controls.orbit(100, 0);
    expect(overview.bearing).toBeCloseTo(210);
    controls.orbit(0, 1000);
    expect(overview.pitch).toBe(overview.maxPitch);
    controls.orbit(0, -1000);
    expect(overview.pitch).toBe(overview.minPitch);
  });

  it('keeps the grabbed ground point under the pointer while panning', () => {
    const { overview, camera, controls } = setup();
    const from = new Vector2(0.1, -0.2);
    const to = new Vector2(-0.3, 0.1);
    const grabbed = groundUnder(camera, overview, from);
    controls.beginPan(from);
    controls.pan(to);
    controls.endPan();
    const after = groundUnder(camera, overview, to);
    expect(after.distanceTo(grabbed)).toBeLessThan(1e-6);
  });

  it('moves with WASD relative to where the camera looks', () => {
    const { overview, controls } = setup();
    const start = overview.target.clone();
    controls.panKeys(1, 0, 0.5);
    // Looking north from the south: forward is −Z.
    expect(overview.target.z).toBeLessThan(start.z);
    expect(overview.target.x).toBeCloseTo(start.x);
    overview.bearing = 90; // camera east of the target, looking west
    overview.target.set(50, 0, 50);
    const middle = overview.target.clone();
    controls.panKeys(0, 1, 0.5);
    expect(overview.target.z).toBeLessThan(middle.z); // right is north
  });

  it('zooms toward the point under the pointer, which stays put', () => {
    const { overview, camera, controls } = setup();
    const pointer = new Vector2(0.4, -0.3);
    const before = groundUnder(camera, overview, pointer);
    const distance = overview.distance;
    controls.zoomAt(pointer, -300);
    expect(overview.distance).toBeLessThan(distance);
    const after = groundUnder(camera, overview, pointer);
    expect(after.distanceTo(before)).toBeLessThan(1e-6);
  });

  it('does not fly far off the map or out of range', () => {
    const { overview, controls } = setup();
    for (let i = 0; i < 200; i++) controls.panKeys(1, 1, 0.5);
    expect(overview.target.x).toBeLessThanOrEqual(100 + overview.margin);
    expect(overview.target.z).toBeGreaterThanOrEqual(-overview.margin);
    for (let i = 0; i < 50; i++) controls.zoomAt(new Vector2(), 1000);
    expect(overview.distance).toBe(overview.maxDistance);
    for (let i = 0; i < 50; i++) controls.zoomAt(new Vector2(), -1000);
    expect(overview.distance).toBe(overview.minDistance);
  });

  it('eases to a focus target and can jump instantly', () => {
    const { overview, controls } = setup();
    controls.flyTo(new Vector3(10, 0, 20), 12, 0.3);
    expect(controls.update(0.1)).toBe(true);
    expect(overview.target.x).toBeGreaterThan(10);
    expect(controls.update(0.3)).toBe(false);
    expect(overview.target.toArray()).toEqual([10, 0, 20]);
    expect(overview.distance).toBe(12);
    controls.flyTo(new Vector3(30, 0, 30), 20, 0);
    expect(controls.update(0)).toBe(false);
    expect(overview.target.toArray()).toEqual([30, 0, 30]);
  });
});
