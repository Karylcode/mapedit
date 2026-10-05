import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { OverviewCamera, fitDistance } from '../src/scene/overview-camera.js';
import { sunDirection } from '../src/scene/sun.js';
import { boxEdgePositions } from '../src/scene/outline.js';

const rounded = (v: Vector3) => v.toArray().map((n) => Math.round(n * 1000) / 1000 + 0);

describe('sun direction', () => {
  it('measures azimuth clockwise from north, seen from above', () => {
    expect(rounded(sunDirection(0, 90))).toEqual([0, 1, 0]);
    expect(rounded(sunDirection(0, 0.000001))).toEqual([0, 0.017, -1]);
    expect(rounded(sunDirection(90, 45))).toEqual([0.707, 0.707, 0]);
    expect(rounded(sunDirection(180, 45))).toEqual([0, 0.707, 0.707]);
  });
});

describe('OverviewCamera', () => {
  it('frames the whole map from the south with north at the top', () => {
    const overview = new OverviewCamera();
    overview.setMap({ x: 200, z: 100 });
    overview.frameMap(40, 1.5);
    const camera = new PerspectiveCamera(40, 1.5);
    overview.apply(camera);
    expect(overview.target.toArray()).toEqual([100, 0, 50]);
    expect(camera.position.z).toBeGreaterThan(50);
    expect(camera.position.x).toBeCloseTo(100);
    const forward = camera.getWorldDirection(new Vector3());
    expect(forward.z).toBeLessThan(0);
  });

  it('keeps the target near the map and the camera within limits', () => {
    const overview = new OverviewCamera();
    overview.setMap({ x: 100, z: 100 });
    overview.target.set(-500, 0, 900);
    overview.distance = 1e6;
    overview.pitch = -20;
    overview.bearing = -90;
    overview.clamp();
    expect(overview.target.x).toBe(-overview.margin);
    expect(overview.target.z).toBe(100 + overview.margin);
    expect(overview.distance).toBe(160);
    expect(overview.pitch).toBe(overview.minPitch);
    expect(overview.bearing).toBe(270);
  });

  it('fits a sphere inside the narrower field of view', () => {
    expect(fitDistance(10, 90, 1)).toBeCloseTo(10 / Math.sin(Math.PI / 4));
    expect(fitDistance(10, 40, 0.5)).toBeGreaterThan(fitDistance(10, 40, 2));
  });
});

describe('box outlines', () => {
  it('emits twelve map-space edges per box', () => {
    const positions = boxEdgePositions([
      {
        matrix: new Matrix4().makeTranslation(10, 0, 0),
        min: new Vector3(0, 0, 0),
        max: new Vector3(1, 2, 3),
      },
    ]);
    expect(positions).toHaveLength(12 * 2 * 3);
    const xs = positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.max(...xs)).toBe(11);
  });
});
