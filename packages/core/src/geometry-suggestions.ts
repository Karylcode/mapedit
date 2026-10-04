import type { Manifold } from 'manifold-3d';
import { structureRef, type Vec3 } from '@mapedit/protocol';
import type { Bounds, Compilation, CompiledInstance } from './domain.js';
import { clean, compareText } from './math.js';
import { socketTypesCompatible } from './socket-rules.js';

export interface AdviceSolid {
  instance: CompiledInstance;
  solid: Manifold;
  bounds: Bounds;
}
export interface TerrainContact {
  overlap: boolean;
  supported: boolean;
}
interface AdviceContext {
  compilation: Compilation;
  entries: readonly AdviceSolid[];
  supportSeeds: ReadonlySet<string>;
  supportLinks: ReadonlyMap<string, ReadonlySet<string>>;
  nearby(bounds: Bounds): AdviceSolid[];
  overlaps(a: AdviceSolid, b: AdviceSolid): boolean;
  terrainContact(entry: AdviceSolid): TerrainContact;
  tolerance: number;
}
interface Candidate {
  clear: boolean;
  supported: ReadonlySet<string>;
}
const directions: { name: string; step: Vec3 }[] = [
  { name: 'east', step: [1, 0, 0] },
  { name: 'west', step: [-1, 0, 0] },
  { name: 'south', step: [0, 0, 1] },
  { name: 'north', step: [0, 0, -1] },
];
const locationText = (location: Vec3): string => `[${location.map(clean).join(', ')}] m`;

/** Bounded advice searches reuse the current solids and never recursively run validation. */
export function createGeometryAdvice(context: AdviceContext): {
  overlap(a: AdviceSolid, b: AdviceSolid | undefined, location: Vec3): string;
  unsupported(entry: AdviceSolid): string;
} {
  const groups = new Map<string, AdviceSolid[]>();
  const byRef = new Map(context.entries.map((entry) => [entry.instance.ref, entry]));
  for (const entry of context.entries) {
    const group = groups.get(entry.instance.structureId) ?? [];
    group.push(entry);
    groups.set(entry.instance.structureId, group);
  }
  const candidates = new Map<string, Candidate>();
  const externalSupport = new Map<string, ReadonlySet<string>>();
  const reachable = (seeds: Iterable<string>, accepts: (ref: string) => boolean): Set<string> => {
    const result = new Set([...seeds].filter(accepts));
    const queue = [...result];
    for (let index = 0; index < queue.length; index++) {
      for (const next of context.supportLinks.get(queue[index]!) ?? []) {
        if (accepts(next) && !result.has(next)) {
          result.add(next);
          queue.push(next);
        }
      }
    }
    return result;
  };
  const supportedOutside = (structureId: string): ReadonlySet<string> => {
    let result = externalSupport.get(structureId);
    if (!result) {
      result = reachable(
        context.supportSeeds,
        (ref) => byRef.get(ref)?.instance.structureId !== structureId,
      );
      externalSupport.set(structureId, result);
    }
    return result;
  };
  const translated = (entry: AdviceSolid, delta: Vec3): AdviceSolid => {
    const solid = entry.solid.translate(delta);
    return { instance: entry.instance, solid, bounds: solid.boundingBox() };
  };
  const candidate = (structureId: string, delta: Vec3): Candidate => {
    const key = `${structureId}:${delta.join(',')}`;
    const cached = candidates.get(key);
    if (cached) return cached;
    const group = groups.get(structureId)!;
    const result: Candidate = { clear: true, supported: new Set() };
    const seeds = new Set<string>();
    const outside = supportedOutside(structureId);
    for (const original of group) {
      const entry = translated(original, delta);
      try {
        const { bounds, instance } = entry;
        if (
          bounds.min[0] < -context.tolerance ||
          bounds.min[2] < -context.tolerance ||
          bounds.max[0] > context.compilation.scene.map.size.x + context.tolerance ||
          bounds.max[2] > context.compilation.scene.map.size.z + context.tolerance
        ) {
          result.clear = false;
          break;
        }
        const neighbors = context
          .nearby(bounds)
          .filter((other) => other.instance.structureId !== structureId);
        if (neighbors.some((other) => context.overlaps(entry, other))) {
          result.clear = false;
          break;
        }
        const terrain = context.terrainContact(entry);
        if (terrain.overlap) {
          result.clear = false;
          break;
        }
        if (terrain.supported || instance.definition.canFloat) seeds.add(instance.ref);
        if (
          !seeds.has(instance.ref) &&
          neighbors.some((other) => outside.has(other.instance.ref))
        ) {
          const probe = translated(entry, [0, -context.tolerance * 2, 0]);
          try {
            if (
              neighbors.some(
                (other) => outside.has(other.instance.ref) && context.overlaps(probe, other),
              )
            )
              seeds.add(instance.ref);
          } finally {
            probe.solid.delete();
          }
        }
      } finally {
        entry.solid.delete();
      }
    }
    if (result.clear)
      result.supported = reachable(
        seeds,
        (ref) => byRef.get(ref)?.instance.structureId === structureId,
      );
    candidates.set(key, result);
    return result;
  };
  const overlap = (a: AdviceSolid, b: AdviceSolid | undefined, location: Vec3): string => {
    const first = structureRef(a.instance.structureId);
    const second = b ? structureRef(b.instance.structureId) : 'terrain';
    if (b && a.instance.structureId === b.instance.structureId) {
      return `${a.instance.ref} overlaps ${b.instance.ref} at ${locationText(location)} inside ${first}. Change a Module's local position or shape; moving their common Structure cannot separate them.`;
    }
    const structureIds = [
      ...new Set([a.instance.structureId, ...(b ? [b.instance.structureId] : [])]),
    ].sort(compareText);
    // Distance is the outer loop, so the first accepted candidate is the shortest
    // legal half-metre move, with deterministic direction/Structure tie breaks.
    for (let step = 1; step <= 10; step++) {
      const distance = step * 0.5;
      for (const direction of directions) {
        const delta = direction.step.map((value) => value * distance) as Vec3;
        for (const structureId of structureIds) {
          if (candidate(structureId, delta).clear) {
            const target = structureId === a.instance.structureId ? second : first;
            return `Move ${structureRef(structureId)} ${direction.name} by ${distance} m to clear the overlap with ${target} at the current geometry and height. Recheck terrain placement and Support after moving.`;
          }
        }
      }
    }
    return `${first} (${a.instance.ref}) overlaps ${second}${b ? ` (${b.instance.ref})` : ''} at ${locationText(location)}. No cardinal move in 0.5 m steps within 5 m clears the current geometry; change its shape or height and run check again.`;
  };
  const unsupported = (entry: AdviceSolid): string => {
    const { instance } = entry;
    for (let step = 1; step <= 6; step++) {
      const distance = step * 0.5;
      const tested = candidate(instance.structureId, [0, -distance, 0]);
      if (tested.clear && tested.supported.has(instance.ref)) {
        const view = context.compilation.scene.structures.find(
          (structure) => structure.ref === structureRef(instance.structureId),
        );
        const height = clean((view?.transform[13] ?? instance.transform[13]!) - distance);
        return `Lower ${structureRef(instance.structureId)} by ${distance} m to reach terrain or a supported Module; set its explicit height to ${height} m and run check again.`;
      }
    }
    const outside = supportedOutside(instance.structureId);
    const ownSockets = context.compilation.sockets.filter(
      (socket) => !socket.occupied && socket.instanceRef === instance.ref,
    );
    const targetSockets = context.compilation.sockets.filter(
      (socket) => !socket.occupied && outside.has(socket.instanceRef),
    );
    const choices = ownSockets
      .flatMap((own) =>
        targetSockets.flatMap((target) => {
          if (!socketTypesCompatible(context.compilation.socketTypes, own.type, target.type))
            return [];
          const ownVertical = Math.abs(own.direction[1]) > 0.5;
          const targetVertical = Math.abs(target.direction[1]) > 0.5;
          if (
            ownVertical !== targetVertical ||
            (ownVertical && own.direction[1] * target.direction[1] >= 0)
          )
            return [];
          const distance = Math.hypot(
            ...own.position.map((value, axis) => value - target.position[axis]!),
          );
          return distance <= 5 ? [{ own, target, distance }] : [];
        }),
      )
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          compareText(a.own.ref, b.own.ref) ||
          compareText(a.target.ref, b.target.ref),
      );
    if (choices[0])
      return `Attach free Socket ${choices[0].own.ref} to compatible supported Socket ${choices[0].target.ref} (${clean(choices[0].distance)} m away), then run check.`;
    return `No clear downward move within 3 m or compatible supported free Socket within 5 m was found for ${instance.ref}. If it is intentionally floating, set canFloat: true in ${instance.definition.source.file}.`;
  };
  return { overlap, unsupported };
}
