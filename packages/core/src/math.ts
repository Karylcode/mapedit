import type { Mat4, Vec3 } from '@mapedit/protocol';
import type { Bounds, SocketDirection } from './domain.js';

export const EPSILON = 1e-7;
/** Locale-independent ordering for stable ids, paths, and compiled output. */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const snap = (value: number, step = 0.5): number => clean(Math.round(value / step) * step);
export const clean = (value: number): number =>
  Math.abs(value) < 1e-10 ? 0 : Math.round(value * 1e10) / 1e10;
export const onGrid = (value: number, step = 0.5): boolean =>
  Math.abs(value / step - Math.round(value / step)) < EPSILON;
export const normalizeRotation = (degrees: number): number => clean(((degrees % 360) + 360) % 360);
export function transformMatrix(position: Vec3, rotation = 0): Mat4 {
  const radians = (rotation * Math.PI) / 180,
    c = clean(Math.cos(radians)),
    s = clean(Math.sin(radians));
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, ...position, 1];
}
export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  return [0, 1, 2].map((row) =>
    clean(
      matrix[row]! * point[0] +
        matrix[row + 4]! * point[1] +
        matrix[row + 8]! * point[2] +
        matrix[row + 12]!,
    ),
  ) as Vec3;
}
export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  return Array.from({ length: 16 }, (_, i) =>
    clean(
      [0, 1, 2, 3].reduce((sum, k) => sum + a[(i % 4) + k * 4]! * b[Math.floor(i / 4) * 4 + k]!, 0),
    ),
  );
}
/** Inverse of a rotation-plus-translation matrix, without general matrix inversion. */
export function inverseRigid(matrix: Mat4): Mat4 {
  const result = [
    matrix[0]!,
    matrix[4]!,
    matrix[8]!,
    0,
    matrix[1]!,
    matrix[5]!,
    matrix[9]!,
    0,
    matrix[2]!,
    matrix[6]!,
    matrix[10]!,
    0,
    0,
    0,
    0,
    1,
  ];
  for (let row = 0; row < 3; row++)
    result[row + 12] = -(
      result[row]! * matrix[12]! +
      result[row + 4]! * matrix[13]! +
      result[row + 8]! * matrix[14]!
    );
  return result;
}
export function transformBounds(matrix: Mat4, size: Vec3): Bounds {
  const points = [0, size[0]].flatMap((x) =>
    [0, size[1]].flatMap((y) => [0, size[2]].map((z) => transformPoint(matrix, [x, y, z]))),
  );
  return {
    min: [0, 1, 2].map((i) => Math.min(...points.map((p) => p[i]!))) as Vec3,
    max: [0, 1, 2].map((i) => Math.max(...points.map((p) => p[i]!))) as Vec3,
  };
}
export function moduleTransform(at: Vec3, size: Vec3, rotation: number): Mat4 {
  const min = transformBounds(transformMatrix([0, 0, 0], rotation), size).min;
  return transformMatrix(at.map((n, i) => clean(n - min[i]!)) as Vec3, rotation);
}
export function directionVector(direction: SocketDirection, rotation = 0): Vec3 {
  const vectors: Record<SocketDirection, Vec3> = {
    north: [0, 0, -1],
    east: [1, 0, 0],
    south: [0, 0, 1],
    west: [-1, 0, 0],
    up: [0, 1, 0],
    down: [0, -1, 0],
  };
  return transformPoint(transformMatrix([0, 0, 0], rotation), vectors[direction]);
}
export const yawOf = (matrix: Mat4): number =>
  clean((Math.atan2(matrix[8]!, matrix[10]!) * 180) / Math.PI);
