import { Vector3 } from 'three';

/**
 * Unit vector from the ground toward the sun. Azimuth is measured clockwise
 * from north as seen from above (0° north/−Z, 90° east/+X); elevation is the
 * angle above the horizon.
 */
export function sunDirection(azimuth: number, elevation: number, target = new Vector3()): Vector3 {
  const a = (azimuth * Math.PI) / 180;
  const e = (Math.max(1, Math.min(90, elevation)) * Math.PI) / 180;
  return target.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
