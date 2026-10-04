import type { Manifold, Mat4 as ManifoldMat4 } from 'manifold-3d';
import type { Mat4, Vec3 } from '@mapedit/protocol';
import type { Bounds, CompiledInstance } from './domain.js';

export const GEOMETRY_TOLERANCE = 0.0001;
/** Intersections smaller than this are contact, not overlap. */
export const MIN_VOLUME = 1e-9;

/** A Module instance's solid, placed in map space. */
export interface PlacedSolid {
  instance: CompiledInstance;
  solid: Manifold;
  bounds: Bounds;
  /** The solid is exactly its axis-aligned bounds, so box arithmetic replaces Booleans. */
  box?: boolean;
}

export const boundsCenter = (bounds: Bounds): Vec3 =>
  bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Vec3;
export const boundsVolume = (bounds: Bounds): number =>
  [0, 1, 2].reduce((volume, axis) => volume * (bounds.max[axis]! - bounds.min[axis]!), 1);
const sharedBounds = (a: Bounds, b: Bounds): Bounds => ({
  min: [0, 1, 2].map((axis) => Math.max(a.min[axis]!, b.min[axis]!)) as Vec3,
  max: [0, 1, 2].map((axis) => Math.min(a.max[axis]!, b.max[axis]!)) as Vec3,
});
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
 * Two solids that fill their bounds intersect in exactly the shared box, which avoids
 * a Boolean operation for the common box-shaped Modules.
 */
export function overlapLocation(a: PlacedSolid, b: PlacedSolid): Vec3 | undefined {
  if (!intersectsBounds(a.bounds, b.bounds, -GEOMETRY_TOLERANCE)) return undefined;
  if (a.box && b.box) {
    const shared = sharedBounds(a.bounds, b.bounds);
    return boundsVolume(shared) > MIN_VOLUME ? boundsCenter(shared) : undefined;
  }
  return manifoldOverlap(a.solid, b.solid);
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
  const probe = upper.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]);
  try {
    return intersectVolume(probe, lower.solid) > MIN_VOLUME;
  } finally {
    probe.delete();
  }
}
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
  };
}
