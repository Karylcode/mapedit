import type { Vec3 } from '@mapedit/protocol';

const DEG = Math.PI / 180;

/** Rotation about +Y of a column-major transform, in degrees (counterclockwise from above). */
export function yawOf(matrix: ArrayLike<number>): number {
  const degrees = Math.atan2(-matrix[2]!, matrix[0]!) / DEG;
  return normalizeAngle(Math.round(degrees * 1000) / 1000);
}

export function normalizeAngle(degrees: number): number {
  const value = ((degrees % 360) + 360) % 360;
  return value === 360 ? 0 : value;
}

/** Turn an x/z offset counterclockwise (seen from above) by `degrees`. */
export function turnXZ(x: number, z: number, degrees: number): [number, number] {
  const c = Math.cos(degrees * DEG);
  const s = Math.sin(degrees * DEG);
  return [x * c + z * s, -x * s + z * c];
}

/** Where an object's origin goes when it turns about a pivot by `degrees`. */
export function turnAbout(origin: Vec3, pivot: Vec3, degrees: number): Vec3 {
  const [x, z] = turnXZ(origin[0] - pivot[0], origin[2] - pivot[2], degrees);
  return [pivot[0] + x, origin[1], pivot[2] + z];
}
