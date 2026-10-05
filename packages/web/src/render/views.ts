import {
  Box3,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera,
} from 'three';
import type { RenderSpec } from '@mapedit/protocol';
import { fitDistance } from '../scene/overview-camera.js';

export type ViewName = RenderSpec['views'][number];

/** Compass bearing (clockwise from north) the camera looks from, for each angled view. */
const BEARINGS: Record<Exclude<ViewName, 'top'>, number> = { ne: 45, se: 135, sw: 225, nw: 315 };
/** How high the angled cameras sit above the horizon, in degrees. */
export const OBLIQUE_ELEVATION = 35;
export const OBLIQUE_FOV = 35;

export interface Region {
  center: Vector3;
  radius: number;
  /** When known, the actual extent; angled views fit it more tightly than the sphere. */
  box?: Box3;
}

/** The region a spec asks for: its focus, or everything drawn on the map. */
export function regionOf(spec: Pick<RenderSpec, 'focus'>, content: Box3): Region {
  if (spec.focus)
    return { center: new Vector3(...spec.focus.center), radius: Math.max(spec.focus.radius, 0.5) };
  const center = content.getCenter(new Vector3());
  return {
    center,
    radius: Math.max(content.getSize(new Vector3()).length() / 2, 1),
    box: content.clone(),
  };
}

/**
 * Pull an angled camera in until the box's corners just fit the square view,
 * keeping a small margin. The view stays aimed at the box center.
 */
function fitBox(camera: PerspectiveCamera, box: Box3, center: Vector3, far: number): void {
  const direction = camera.position.clone().sub(center).normalize();
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );
  const fits = (distance: number) => {
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    return corners.every((corner) => {
      const p = corner.clone().project(camera);
      return p.z < 1 && Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.94;
    });
  };
  let low = 0;
  let high = far;
  for (let i = 0; i < 30; i++) {
    const middle = (low + high) / 2;
    if (fits(middle)) high = middle;
    else low = middle;
  }
  fits(high);
}

/**
 * A camera for one view of a square tile. `top` looks straight down with
 * north (−Z) at the top; the others look at the center from above that
 * compass direction, e.g. `ne` from the north-east.
 */
export function viewCamera(view: ViewName, region: Region): Camera {
  const { center, radius } = region;
  if (view === 'top') {
    const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.1, radius * 8 + 100);
    camera.position.set(center.x, center.y + radius * 3 + 50, center.z);
    camera.up.set(0, 0, -1);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  }
  const bearing = MathUtils.degToRad(BEARINGS[view]);
  const elevation = MathUtils.degToRad(OBLIQUE_ELEVATION);
  const distance = fitDistance(radius, OBLIQUE_FOV, 1);
  const camera = new PerspectiveCamera(
    OBLIQUE_FOV,
    1,
    Math.max(0.01, distance * 0.01),
    distance + radius * 4 + 100,
  );
  camera.position
    .set(
      Math.sin(bearing) * Math.cos(elevation),
      Math.sin(elevation),
      -Math.cos(bearing) * Math.cos(elevation),
    )
    .multiplyScalar(distance)
    .add(center);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (region.box) {
    fitBox(camera, region.box, center, distance);
    camera.near = Math.max(0.01, camera.position.distanceTo(center) * 0.01);
    camera.updateProjectionMatrix();
  }
  return camera;
}

/** Tiles per row: one row for up to three views, then two rows. */
export function montageLayout(count: number): { columns: number; rows: number } {
  const columns = count <= 3 ? count : Math.ceil(count / 2);
  return { columns, rows: Math.ceil(count / columns) };
}
