import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  FIRST_PERSON_FOV,
  FirstPersonCamera,
  FLY_SPEED,
  SPEED_RANGE,
} from '../src/scene/first-person-camera.js';
import { OverviewCamera } from '../src/scene/overview-camera.js';
import { hintsFor } from '../src/editor/hud/action-bar.js';

const close = (v: Vector3, expected: [number, number, number]) =>
  expect(v.toArray().map((n) => Math.round(n * 1000) / 1000)).toEqual(expected);

describe('FirstPersonCamera', () => {
  it('takes over the overview camera without the view jumping', () => {
    const overview = new OverviewCamera();
    overview.setMap({ x: 100, z: 100 });
    overview.target.set(50, 0, 50);
    overview.bearing = 200;
    overview.pitch = 40;
    overview.distance = 30;
    const camera = new PerspectiveCamera();
    overview.apply(camera);
    const before = camera.getWorldDirection(new Vector3());

    const eye = new FirstPersonCamera();
    eye.setMap({ x: 100, z: 100 });
    eye.fromOverview(overview);
    eye.apply(camera);
    expect(
      camera.position.distanceTo(overview.target.clone().addScaledVector(overview.offset(), 30)),
    ).toBeLessThan(1e-9);
    expect(camera.getWorldDirection(new Vector3()).angleTo(before)).toBeLessThan(1e-6);
    // First person looks around with a wider view; the overview keeps its own.
    expect(camera.fov).toBe(FIRST_PERSON_FOV);
    overview.apply(camera);
    expect(camera.fov).toBe(40);
  });

  it('flies level with the ground whatever the pitch, like Minecraft', () => {
    const eye = new FirstPersonCamera();
    eye.position.set(50, 10, 50);
    eye.heading = 0; // north, toward −Z
    eye.pitch = -60;
    eye.move(1, 0, 0, 1);
    close(eye.position, [50, 10, 50 - FLY_SPEED]);
    eye.heading = 90; // east
    eye.move(0, 1, 0, 1); // right of east is south, +Z
    close(eye.position, [50, 10, 50]);
    eye.move(0, 0, 1, 0.5);
    close(eye.position, [50, 10 + FLY_SPEED / 2, 50]);
    // Diagonals are no faster than straight lines.
    const start = eye.position.clone();
    eye.move(1, 1, 0, 1);
    expect(eye.position.distanceTo(start)).toBeCloseTo(FLY_SPEED);
  });

  it('turns with the mouse, never past straight up or down, and stays above the ground', () => {
    const eye = new FirstPersonCamera();
    eye.look(100, 0);
    expect(eye.heading).toBeCloseTo(15);
    eye.look(0, -10_000);
    expect(eye.pitch).toBe(89);
    eye.position.set(10, 1, 10);
    eye.move(0, 0, -1, 10, () => 2);
    expect(eye.position.y).toBeCloseTo(2.3);
  });

  it('flies faster when the wheel scrolls up, within limits', () => {
    const eye = new FirstPersonCamera();
    eye.changeSpeed(-500);
    expect(eye.speed).toBeGreaterThan(FLY_SPEED);
    eye.changeSpeed(1e6);
    expect(eye.speed).toBe(SPEED_RANGE.min);
    eye.changeSpeed(-1e6);
    expect(eye.speed).toBe(SPEED_RANGE.max);
    eye.position.set(50, 10, 50);
    eye.move(0, 0, 1, 1);
    expect(eye.position.y).toBeCloseTo(10 + SPEED_RANGE.max);
  });

  it('hands back an overview above where the eye was, facing the same way', () => {
    const overview = new OverviewCamera();
    overview.setMap({ x: 100, z: 100 });
    overview.pitch = 50;
    overview.distance = 40;
    const eye = new FirstPersonCamera();
    eye.position.set(30, 5, 60);
    eye.heading = 90;
    eye.toOverview(overview, 1);
    expect(overview.bearing).toBe(270);
    const camera = overview.target.clone().addScaledVector(overview.offset(), overview.distance);
    expect(camera.x).toBeCloseTo(30);
    expect(camera.z).toBeCloseTo(60);
    expect(overview.target.y).toBe(1);
  });
});

it('shows flying keys in first-person mode and V in the overview', () => {
  expect(hintsFor(undefined, undefined).some((hint) => hint.keys.includes('V'))).toBe(true);
  expect(hintsFor(undefined, undefined, true).map((hint) => hint.action)).toEqual([
    'action.look',
    'action.fly',
    'action.rise',
    'action.sink',
    'action.flySpeed',
    'action.leaveFirstPerson',
  ]);
});
