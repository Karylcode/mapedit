import { parseObjectRef, type ObjectRef } from '@mapedit/protocol';
import type { SnapshotIndex } from '../scene/snapshot-index.js';

/**
 * What a click selects. The first click on a module selects its whole
 * structure; clicking a module of the already selected structure (or another
 * module of it) selects just that module, so it can be deleted on its own.
 */
export function clickSelection(
  current: ObjectRef | undefined,
  hit: ObjectRef | undefined,
  index: SnapshotIndex,
): ObjectRef | undefined {
  if (!hit) return undefined;
  if (index.markers.has(hit)) return hit;
  const structure = index.structureOf(hit);
  if (!structure) return undefined;
  if (parseObjectRef(hit)?.kind !== 'module') return structure.ref;
  const currentStructure = current ? index.structureOf(current) : undefined;
  return currentStructure === structure ? hit : structure.ref;
}

/** Drop a selection whose object no longer exists in the snapshot. */
export function keepSelection(
  current: ObjectRef | undefined,
  index: SnapshotIndex,
): ObjectRef | undefined {
  return current && index.has(current) ? current : undefined;
}

/** The structure or marker that moves when the selection is dragged or rotated. */
export function movableOf(ref: ObjectRef, index: SnapshotIndex): ObjectRef | undefined {
  if (index.markers.has(ref)) return ref;
  return index.structureOf(ref)?.ref;
}
