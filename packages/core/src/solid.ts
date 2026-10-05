import type { Manifold, Mat4 as ManifoldMat4 } from 'manifold-3d';
import type { Mat4, Vec3 } from '@mapedit/protocol';
import type { Bounds, CompiledInstance } from './domain.js';

export const GEOMETRY_TOLERANCE = 0.0001;
/** Intersections smaller than this are contact, not overlap. */
export const MIN_VOLUME = 1e-9;

/** A box along a solid's own axes, in map space, that contains the whole solid. */
export interface OrientedBox {
  center: Vec3;
  /** Unit vectors. */
  axes: [Vec3, Vec3, Vec3];
  /** Half sizes along `axes`. */
  half: Vec3;
}
/** A Module instance's solid, placed in map space. */
export interface PlacedSolid {
  instance: CompiledInstance;
  solid: Manifold;
  bounds: Bounds;
  /** The solid is exactly its axis-aligned bounds, so box arithmetic replaces Booleans. */
  box?: boolean;
  /** Contains the solid, so solids whose oriented boxes are apart need no Boolean. */
  oriented?: OrientedBox;
}

export const boundsCenter = (bounds: Bounds): Vec3 =>
  bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Vec3;
export const boundsVolume = (bounds: Bounds): number =>
  [0, 1, 2].reduce((volume, axis) => volume * (bounds.max[axis]! - bounds.min[axis]!), 1);
const sharedBounds = (a: Bounds, b: Bounds): Bounds => ({
  min: [0, 1, 2].map((axis) => Math.max(a.min[axis]!, b.min[axis]!)) as Vec3,
  max: [0, 1, 2].map((axis) => Math.min(a.max[axis]!, b.max[axis]!)) as Vec3,
});
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A matrix's rotation applied to a direction. */
const rotateVector = (matrix: Mat4, vector: Vec3): Vec3 =>
  [0, 1, 2].map(
    (row) => matrix[row]! * vector[0] + matrix[row + 4]! * vector[1] + matrix[row + 8]! * vector[2],
  ) as Vec3;
const movePoint = (matrix: Mat4, point: Vec3): Vec3 =>
  rotateVector(matrix, point).map((value, row) => value + matrix[row + 12]!) as Vec3;
/** The oriented box of `local` bounds placed by a rigid matrix. */
export function orientedBox(local: Bounds, matrix: Mat4): OrientedBox {
  const axes = [0, 1, 2].map((column) => {
    const axis = [matrix[column * 4]!, matrix[column * 4 + 1]!, matrix[column * 4 + 2]!] as Vec3;
    const length = Math.hypot(...axis);
    return { unit: axis.map((value) => value / length) as Vec3, length };
  });
  return {
    center: movePoint(matrix, boundsCenter(local)),
    axes: axes.map((axis) => axis.unit) as [Vec3, Vec3, Vec3],
    half: axes.map(
      (axis, index) => ((local.max[index]! - local.min[index]!) / 2) * axis.length,
    ) as Vec3,
  };
}
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/**
 * How far apart two oriented boxes must be before a Boolean is skipped, so rounding
 * between a box and its solid never changes an exact result.
 */
const SKIP_GAP = 1e-7;
/** Map-axis bounds as an oriented box. */
export const axisAlignedBox = (bounds: Bounds): OrientedBox => orientedBox(bounds, IDENTITY);
function moveOrientedBox(box: OrientedBox, matrix: Mat4): OrientedBox {
  return {
    center: movePoint(matrix, box.center),
    axes: box.axes.map((axis) => rotateVector(matrix, axis)) as [Vec3, Vec3, Vec3],
    half: box.half,
  };
}
/**
 * Whether two oriented boxes share volume deeper than `margin` along every separating axis.
 * Boxes that are apart, or that only touch within the margin, do not overlap.
 */
export function orientedBoxesOverlap(
  a: OrientedBox,
  b: OrientedBox,
  margin = GEOMETRY_TOLERANCE,
): boolean {
  const offset = b.center.map((value, axis) => value - a.center[axis]!) as Vec3;
  const cross = (u: Vec3, v: Vec3): Vec3 => [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const reach = (box: OrientedBox, axis: Vec3) =>
    box.axes.reduce((sum, own, index) => sum + box.half[index]! * Math.abs(dot(own, axis)), 0);
  for (const candidate of [
    ...a.axes,
    ...b.axes,
    ...a.axes.flatMap((u) => b.axes.map((v) => cross(u, v))),
  ]) {
    const length = Math.hypot(...candidate);
    // Parallel edge pairs give no axis; the face axes already cover them.
    if (length < 1e-9) continue;
    const axis = candidate.map((value) => value / length) as Vec3;
    if (Math.abs(dot(offset, axis)) >= reach(a, axis) + reach(b, axis) - margin) return false;
  }
  return true;
}
export function intersectsBounds(a: Bounds, b: Bounds, margin = 0): boolean {
  return [0, 1, 2].every(
    (axis) => a.max[axis]! + margin > b.min[axis]! && b.max[axis]! + margin > a.min[axis]!,
  );
}
/** A solid whose volume equals the volume of its axis-aligned bounds is exactly that box. */
export function fillsBounds(volume: number, bounds: Bounds): boolean {
  return Math.abs(volume - boundsVolume(bounds)) <= MIN_VOLUME;
}
export function intersectVolume(a: Manifold, b: Manifold): number {
  const intersection = a.intersect(b);
  try {
    return intersection.volume();
  } finally {
    intersection.delete();
  }
}
/** One Boolean operation gives both the overlap test and its location. */
export function manifoldOverlap(a: Manifold, b: Manifold): Vec3 | undefined {
  const intersection = a.intersect(b);
  try {
    return intersection.volume() > MIN_VOLUME
      ? boundsCenter(intersection.boundingBox())
      : undefined;
  } finally {
    intersection.delete();
  }
}
/**
 * Where two placed solids overlap, or undefined when they only touch or are apart.
 * Two solids that fill their bounds intersect in exactly the shared box, and solids whose
 * oriented boxes are apart cannot meet, which avoids most Boolean operations.
 * `beforeBoolean` runs right before a Boolean operation, so callers can count them.
 */
export function overlapLocation(
  a: PlacedSolid,
  b: PlacedSolid,
  beforeBoolean?: () => void,
): Vec3 | undefined {
  if (!intersectsBounds(a.bounds, b.bounds, -GEOMETRY_TOLERANCE)) return undefined;
  if (a.box && b.box) {
    const shared = sharedBounds(a.bounds, b.bounds);
    return boundsVolume(shared) > MIN_VOLUME ? boundsCenter(shared) : undefined;
  }
  if (a.oriented && b.oriented && !orientedBoxesOverlap(a.oriented, b.oriented, -SKIP_GAP))
    return undefined;
  beforeBoolean?.();
  return manifoldOverlap(a.solid, b.solid);
}
/**
 * The overlap test without Booleans: oriented boxes stand in for the solids, so it may
 * report overlaps that the exact shapes do not have. Located at the shared bounds' center.
 */
export function estimatedOverlap(a: PlacedSolid, b: PlacedSolid): Vec3 | undefined {
  if (!intersectsBounds(a.bounds, b.bounds, -GEOMETRY_TOLERANCE)) return undefined;
  const overlapping = orientedBoxesOverlap(
    a.oriented ?? axisAlignedBox(a.bounds),
    b.oriented ?? axisAlignedBox(b.bounds),
  );
  return overlapping ? boundsCenter(sharedBounds(a.bounds, b.bounds)) : undefined;
}
/** Whether `upper`, nudged down by twice the tolerance, rests on `lower`. */
export function restsOn(upper: PlacedSolid, lower: PlacedSolid): boolean {
  const nudged: Bounds = {
    min: [upper.bounds.min[0], upper.bounds.min[1] - GEOMETRY_TOLERANCE * 2, upper.bounds.min[2]],
    max: [upper.bounds.max[0], upper.bounds.max[1] - GEOMETRY_TOLERANCE * 2, upper.bounds.max[2]],
  };
  // Solids whose bounds only share a face, such as neighbours side by side, share no volume.
  if (!intersectsBounds(nudged, lower.bounds)) return false;
  if (upper.box && lower.box) return boundsVolume(sharedBounds(nudged, lower.bounds)) > MIN_VOLUME;
  if (
    upper.oriented &&
    lower.oriented &&
    !orientedBoxesOverlap(nudgedBox(upper.oriented), lower.oriented, -SKIP_GAP)
  )
    return false;
  const probe = upper.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]);
  try {
    return intersectVolume(probe, lower.solid) > MIN_VOLUME;
  } finally {
    probe.delete();
  }
}
const nudgedBox = (box: OrientedBox): OrientedBox => ({
  ...box,
  center: [box.center[0], box.center[1] - GEOMETRY_TOLERANCE * 2, box.center[2]],
});
/** A rigidly moved copy; the caller deletes its solid. */
export function moveSolid(entry: PlacedSolid, matrix: Mat4): PlacedSolid {
  const solid = entry.solid.transform(matrix as ManifoldMat4);
  const bounds = solid.boundingBox();
  // Rigid motion keeps the volume, so a box stays a box while its bounds keep their volume.
  return {
    instance: entry.instance,
    solid,
    bounds,
    box: entry.box === true && fillsBounds(boundsVolume(entry.bounds), bounds),
    ...(entry.oriented ? { oriented: moveOrientedBox(entry.oriented, matrix) } : {}),
  };
}
