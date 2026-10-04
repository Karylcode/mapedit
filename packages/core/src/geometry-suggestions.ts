import { parseObjectRef, structureRef, type Mat4, type Vec3 } from '@mapedit/protocol';
import type { Bounds, Compilation, CompiledSocket } from './domain.js';
import { clean, compareText, inverseRigid, multiplyMatrices, transformMatrix } from './math.js';
import { socketAttachment, socketTypesCompatible } from './socket-rules.js';
import { moveSolid, type PlacedSolid } from './solid.js';
import { supportedFrom } from './support.js';

export interface TerrainContact {
  overlap: boolean;
  supported: boolean;
}
interface AdviceContext {
  compilation: Compilation;
  entries: readonly PlacedSolid[];
  supportSeeds: ReadonlySet<string>;
  supportLinks: ReadonlyMap<string, ReadonlySet<string>>;
  nearby(bounds: Bounds): PlacedSolid[];
  overlaps(a: PlacedSolid, b: PlacedSolid): boolean;
  terrainContact(entry: PlacedSolid): TerrainContact;
  tolerance: number;
}
/** The result of moving some Modules rigidly while every other Module stays in place. */
interface Placement {
  clear: boolean;
  /** Moved Modules that would have Support. */
  supported: ReadonlySet<string>;
  /** What a moved Module would rest on: 'terrain' or the supporting Module ref. */
  restsOn: ReadonlyMap<string, string>;
}
/** A compatible free Socket pair that could give an unsupported Module Support. */
interface SocketOption {
  own: CompiledSocket;
  target: CompiledSocket;
  distance: number;
  clear: boolean;
  text: string;
}
const directions: { name: string; step: Vec3 }[] = [
  { name: 'east', step: [1, 0, 0] },
  { name: 'west', step: [-1, 0, 0] },
  { name: 'south', step: [0, 0, 1] },
  { name: 'north', step: [0, 0, -1] },
];
const locationText = (location: Vec3): string => `[${location.map(clean).join(', ')}] m`;
const SOCKET_SEARCH_DISTANCE = 5;

/** Describe where the target Socket is, seen from the own Socket. */
function socketRelation(own: CompiledSocket, target: CompiledSocket): string {
  const delta = target.position.map((value, axis) => value - own.position[axis]!);
  const horizontal = Math.hypot(delta[0]!, delta[2]!);
  if (horizontal < 1e-6 && Math.abs(delta[1]!) < 1e-6) return 'already aligned';
  if (horizontal < 1e-6)
    return `${clean(Math.abs(delta[1]!))} m ${delta[1]! < 0 ? 'below' : 'above'}`;
  return `${clean(Math.hypot(horizontal, delta[1]!))} m away`;
}

/** Bounded advice searches reuse the current solids and never recursively run validation. */
export function createGeometryAdvice(context: AdviceContext): {
  overlap(a: PlacedSolid, b: PlacedSolid | undefined, location: Vec3): string;
  unsupported(entry: PlacedSolid): string;
} {
  const solidsByStructure = new Map<string, PlacedSolid[]>();
  const byRef = new Map(context.entries.map((entry) => [entry.instance.ref, entry]));
  const instances = new Map(context.compilation.instances.map((item) => [item.ref, item]));
  const attachedChildren = new Map<string, string[]>();
  for (const entry of context.entries) {
    const solids = solidsByStructure.get(entry.instance.structureId) ?? [];
    solids.push(entry);
    solidsByStructure.set(entry.instance.structureId, solids);
  }
  for (const instance of context.compilation.instances)
    if (instance.attachTo)
      attachedChildren.set(instance.attachTo, [
        ...(attachedChildren.get(instance.attachTo) ?? []),
        instance.ref,
      ]);
  const placements = new Map<string, Placement>();
  const supportedWithout = new Map<string, ReadonlySet<string>>();
  const reachable = (seeds: Iterable<string>, accepts: (ref: string) => boolean) =>
    supportedFrom(seeds, context.supportLinks, accepts);
  const supportedNow = reachable(context.supportSeeds, () => true);
  /** Support that remains when the moving Modules are taken away. */
  const supportedOutside = (key: string, moving: ReadonlySet<string>): ReadonlySet<string> => {
    let result = supportedWithout.get(key);
    if (!result) {
      result = reachable(context.supportSeeds, (ref) => !moving.has(ref));
      supportedWithout.set(key, result);
    }
    return result;
  };
  /** Test a rigid move of `group`, identified by `key`, against all Modules that stay. */
  const place = (key: string, group: readonly PlacedSolid[], matrix: Mat4): Placement => {
    const cacheKey = `${key}|${matrix.map(clean).join(',')}`;
    const cached = placements.get(cacheKey);
    if (cached) return cached;
    const moving = new Set(group.map((entry) => entry.instance.ref));
    const outside = supportedOutside(key, moving);
    const result: Placement = { clear: true, supported: new Set(), restsOn: new Map() };
    const seeds = new Set<string>();
    const restsOn = new Map<string, string>();
    for (const original of group) {
      const entry = moveSolid(original, matrix);
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
        const neighbors = context.nearby(bounds).filter((other) => !moving.has(other.instance.ref));
        if (neighbors.some((other) => context.overlaps(entry, other))) {
          result.clear = false;
          break;
        }
        const terrain = context.terrainContact(entry);
        if (terrain.overlap) {
          result.clear = false;
          break;
        }
        if (terrain.supported) restsOn.set(instance.ref, 'terrain');
        if (terrain.supported || instance.definition.canFloat) seeds.add(instance.ref);
        if (
          !seeds.has(instance.ref) &&
          neighbors.some((other) => outside.has(other.instance.ref))
        ) {
          const probe = moveSolid(entry, transformMatrix([0, -context.tolerance * 2, 0]));
          try {
            const support = neighbors.find(
              (other) => outside.has(other.instance.ref) && context.overlaps(probe, other),
            );
            if (support) {
              seeds.add(instance.ref);
              restsOn.set(instance.ref, support.instance.ref);
            }
          } finally {
            probe.solid.delete();
          }
        }
      } finally {
        entry.solid.delete();
      }
    }
    if (result.clear) {
      result.supported = reachable(seeds, (ref) => moving.has(ref));
      result.restsOn = restsOn;
    }
    placements.set(cacheKey, result);
    return result;
  };
  /** A Module moves together with every Module attached to it through its own Sockets. */
  const attachmentChain = (ref: string): PlacedSolid[] => {
    const refs = [ref];
    for (let index = 0; index < refs.length; index++)
      refs.push(...(attachedChildren.get(refs[index]!) ?? []));
    return refs.flatMap((item) => byRef.get(item) ?? []);
  };
  const overlap = (a: PlacedSolid, b: PlacedSolid | undefined, location: Vec3): string => {
    const first = structureRef(a.instance.structureId);
    const second = b ? structureRef(b.instance.structureId) : 'terrain';
    if (b && a.instance.structureId === b.instance.structureId) {
      return `${a.instance.ref} overlaps ${b.instance.ref} at ${locationText(location)} inside ${first}. Change a Module's local position or shape; moving their common Structure cannot separate them.`;
    }
    const structureIds = [
      ...new Set([a.instance.structureId, ...(b ? [b.instance.structureId] : [])]),
    ].sort(compareText);
    // Distance is the outer loop, so the first accepted placement is the shortest
    // legal half-metre move, with deterministic direction/Structure tie breaks.
    for (let step = 1; step <= 10; step++) {
      const distance = step * 0.5;
      for (const direction of directions) {
        const delta = direction.step.map((value) => value * distance) as Vec3;
        for (const structureId of structureIds) {
          const solids = solidsByStructure.get(structureId)!;
          if (place(`structure:${structureId}`, solids, transformMatrix(delta)).clear) {
            const target = structureId === a.instance.structureId ? second : first;
            return `Move ${structureRef(structureId)} ${direction.name} by ${distance} m to clear the overlap with ${target} at the current geometry and height. Recheck terrain placement and Support after moving.`;
          }
        }
      }
    }
    return `${first} (${a.instance.ref}) overlaps ${second}${b ? ` (${b.instance.ref})` : ''} at ${locationText(location)}. No cardinal move in 0.5 m steps within 5 m clears the current geometry; change its shape or height and run check again.`;
  };
  /** Compatible free Sockets of supported Modules, nearest first, including the own Structure. */
  const socketOptions = (entry: PlacedSolid): SocketOption[] => {
    const { instance } = entry;
    const owner = parseObjectRef(instance.ref);
    if (owner?.kind !== 'module') return [];
    const chain = attachmentChain(instance.ref);
    const chainRefs = new Set(chain.map((item) => item.instance.ref));
    const ownSockets = context.compilation.sockets.filter(
      (socket) => !socket.occupied && socket.instanceRef === instance.ref,
    );
    const targetSockets = context.compilation.sockets.filter(
      (socket) =>
        !socket.occupied &&
        supportedNow.has(socket.instanceRef) &&
        !chainRefs.has(socket.instanceRef),
    );
    const options: SocketOption[] = [];
    for (const own of ownSockets)
      for (const target of targetSockets) {
        if (!socketTypesCompatible(context.compilation.socketTypes, own.type, target.type))
          continue;
        const ownVertical = Math.abs(own.direction[1]) > 0.5;
        const targetVertical = Math.abs(target.direction[1]) > 0.5;
        if (
          ownVertical !== targetVertical ||
          (ownVertical && own.direction[1] * target.direction[1] >= 0)
        )
          continue;
        const distance = Math.hypot(
          ...own.position.map((value, axis) => value - target.position[axis]!),
        );
        const targetInstance = instances.get(target.instanceRef);
        const targetOwner = parseObjectRef(target.instanceRef);
        const ownSocket = instance.definition.sockets.find((socket) => socket.id === own.id);
        const targetSocket = targetInstance?.definition.sockets.find(
          (socket) => socket.id === target.id,
        );
        if (
          distance > SOCKET_SEARCH_DISTANCE ||
          !targetInstance ||
          targetOwner?.kind !== 'module' ||
          !ownSocket ||
          !targetSocket
        )
          continue;
        const sameStructure = targetOwner.structureId === owner.structureId;
        // Another Structure is joined with a Structure attachment, which moves the whole
        // Structure. Only an unattached root can be attached that way without a cycle.
        if (
          !sameStructure &&
          (owner.structureId !== instance.structureId ||
            targetInstance.structureId === instance.structureId)
        )
          continue;
        const attached = socketAttachment(
          { socket: ownSocket, transform: transformMatrix([0, 0, 0]) },
          { socket: targetSocket, transform: targetInstance.transform },
        );
        if (!attached.facing) continue;
        const matrix = multiplyMatrices(attached.transform, inverseRigid(instance.transform));
        const group = sameStructure ? chain : (solidsByStructure.get(instance.structureId) ?? []);
        const clear = place(
          sameStructure ? `module:${instance.ref}` : `structure:${instance.structureId}`,
          group,
          matrix,
        ).clear;
        const relation = socketRelation(own, target);
        const text = sameStructure
          ? `Attach ${owner.instanceId} to ${targetOwner.instanceId}.${target.id} (${relation}): in ${instance.source.file} ${instance.attachTo ? `change the attach of ${owner.instanceId} to` : `replace the at and rotation of ${owner.instanceId} with`} attach: {socket: ${own.id}, to: ${targetOwner.instanceId}.${target.id}}`
          : `Attach ${structureRef(owner.structureId)} to ${targetOwner.structureId}/${targetOwner.instanceId}.${target.id} (${relation}): in ${instance.source.file} replace the position, height and rotation of Structure ${owner.structureId} with attach: {socket: ${owner.instanceId}.${own.id}, to: ${targetOwner.structureId}/${targetOwner.instanceId}.${target.id}}`;
        options.push({ own, target, distance, clear, text });
      }
    return options.sort(
      (a, b) =>
        a.distance - b.distance ||
        compareText(a.own.ref, b.own.ref) ||
        compareText(a.target.ref, b.target.ref),
    );
  };
  /** Lower only this Module and the Modules attached to it onto terrain or a supported Module. */
  const lowerModule = (entry: PlacedSolid): string | undefined => {
    const { instance } = entry;
    const owner = parseObjectRef(instance.ref);
    // Attached and terrain-following Modules take their height from elsewhere.
    if (owner?.kind !== 'module' || instance.attachTo || instance.definition.terrainFollow)
      return undefined;
    const chain = attachmentChain(instance.ref);
    for (let step = 1; step <= 6; step++) {
      const distance = step * 0.5;
      const tested = place(`module:${instance.ref}`, chain, transformMatrix([0, -distance, 0]));
      if (!tested.clear || !tested.supported.has(instance.ref)) continue;
      const support = tested.restsOn.get(instance.ref) ?? [...tested.restsOn.values()][0];
      return `Lower ${owner.instanceId} by ${distance} m (subtract ${distance} from the y value of its at in ${instance.source.file}) so it rests on ${support === 'terrain' ? 'the terrain' : (support ?? 'a supported Module')}, then run check.`;
    }
    return undefined;
  };
  const unsupported = (entry: PlacedSolid): string => {
    const { instance } = entry;
    // Moving the whole Structure keeps its layout, so it comes first.
    const solids = solidsByStructure.get(instance.structureId)!;
    for (let step = 1; step <= 6; step++) {
      const distance = step * 0.5;
      const tested = place(
        `structure:${instance.structureId}`,
        solids,
        transformMatrix([0, -distance, 0]),
      );
      if (tested.clear && tested.supported.has(instance.ref)) {
        const view = context.compilation.scene.structures.find(
          (structure) => structure.ref === structureRef(instance.structureId),
        );
        const height = clean((view?.transform[13] ?? instance.transform[13]!) - distance);
        return `Lower ${structureRef(instance.structureId)} by ${distance} m to reach terrain or a supported Module; set its explicit height to ${height} m and run check again.`;
      }
    }
    const options = socketOptions(entry);
    const clear = options.find((option) => option.clear);
    if (clear) return `${clear.text}, then run check.`;
    const lowered = lowerModule(entry);
    if (lowered) return lowered;
    // A compatible Socket is the intended fix even when something is in the way.
    if (options[0])
      return `${options[0].text}. The attached position overlaps another Module or the terrain, so move that obstruction too, then run check.`;
    return `No clear downward move of ${structureRef(instance.structureId)} or ${instance.ref} within 3 m and no compatible supported free Socket within ${SOCKET_SEARCH_DISTANCE} m was found for ${instance.ref}. If it is intentionally floating, set canFloat: true in ${instance.definition.source.file}.`;
  };
  return { overlap, unsupported };
}
