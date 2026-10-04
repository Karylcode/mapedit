import type { Attachment, Bounds, MapDefinition, ParsedProject, Socket } from './domain.js';
import { clean, compareText, EPSILON } from './math.js';
import { compatibleSocketTypes } from './socket-rules.js';

/** One side of a Socket connection, as named in diagnostics. */
export interface SocketSide {
  instanceRef: string;
  socket: Socket;
}

/** Up to three closest existing ids by edit distance, followed by the general fix. */
function referenceSuggestion(value: string, candidates: string[], fallback: string): string {
  const distance = (candidate: string): number => {
    let row = Array.from({ length: candidate.length + 1 }, (_, index) => index);
    for (let i = 0; i < value.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < candidate.length; j++)
        next.push(
          Math.min(next[j]! + 1, row[j + 1]! + 1, row[j]! + (value[i] === candidate[j] ? 0 : 1)),
        );
      row = next;
    }
    return row[candidate.length]!;
  };
  const closest = [...new Set(candidates)]
    .map((id) => ({ id, distance: distance(id) }))
    .sort((a, b) => a.distance - b.distance || compareText(a.id, b.id))
    .slice(0, 3);
  return closest.length
    ? `Closest existing ids to "${value}": ${closest.map(({ id }) => `"${id}"`).join(', ')}. ${fallback}`
    : fallback;
}

/**
 * English suggestion text for compiler violations. The compiler decides which violations
 * exist and their identity; this module only words the fix, like geometry-suggestions.ts.
 */
export function createCompilerAdvice(parsed: ParsedProject) {
  const { socketTypes, materials, markerTypes } = parsed.project;
  const accepts = (sides: SocketSide[]): string =>
    sides
      .map(
        ({ instanceRef, socket }) =>
          `Socket ${instanceRef}.${socket.id} (${socket.type}) accepts: ${compatibleSocketTypes(socketTypes, socket.type).join(', ') || 'no declared types'}.`,
      )
      .join(' ');
  return {
    grid: (label: string, nearest: number[]): string =>
      `Set ${label} to ${nearest.length === 1 ? nearest[0] : `[${nearest.join(', ')}]`} m (nearest legal 0.5 m values).`,
    rotation: (nearest: number): string => `Use ${nearest} degrees.`,
    /** Move the whole Structure the shortest legal distance inside the map. */
    bounds(ref: string, bounds: Bounds, size: MapDefinition['size']): string {
      const moves: string[] = [];
      for (const [axis, limit, forward, backward] of [
        [0, size.x, 'east', 'west'],
        [2, size.z, 'south', 'north'],
      ] as const) {
        const minimum = Math.ceil((-bounds.min[axis] - EPSILON) / 0.5) * 0.5;
        const maximum = Math.floor((limit - bounds.max[axis] + EPSILON) / 0.5) * 0.5;
        if (minimum > maximum)
          return `Resize or split ${ref}; its full bounds cannot fit within the map's ${size.x} by ${size.z} m boundary on the 0.5 m grid.`;
        const delta = minimum > 0 ? minimum : maximum < 0 ? maximum : 0;
        if (delta) moves.push(`${delta > 0 ? forward : backward} by ${clean(Math.abs(delta))} m`);
      }
      return `Move ${ref} ${moves.join(' and ')} to put its whole shape inside the map.`;
    },
    unknownCompatibleType: (type: string): string =>
      referenceSuggestion(
        type,
        Object.keys(socketTypes),
        `Correct compatibleWith or define socketTypes.${type}.`,
      ),
    unknownSocketType: (type: string): string =>
      referenceSuggestion(
        type,
        Object.keys(socketTypes),
        `Correct the type or define socketTypes.${type} in project.yaml.`,
      ),
    unknownMaterial: (material: string): string =>
      referenceSuggestion(material, materials, 'Choose an existing material id.'),
    unknownModule: (module: string): string =>
      referenceSuggestion(
        module,
        Object.keys(parsed.modules),
        'Use an existing module id or create its module.yaml and model.ts.',
      ),
    unknownMarkerType: (type: string): string =>
      referenceSuggestion(
        type,
        Object.keys(markerTypes),
        `Correct the type or define markerTypes.${type} in project.yaml.`,
      ),
    moduleCycle: (): string => 'Give one module an at position and remove the attachment cycle.',
    structureCycle: (): string => 'Keep one structure positioned and remove the attachment cycle.',
    /** `ownSockets` are this Module's Socket ids; `targets` are `instance.socket` addresses. */
    moduleAttachment: (attach: Attachment, ownSockets: string[], targets: string[]): string =>
      `${referenceSuggestion(attach.socket, ownSockets, 'Set attach.socket to an own Socket id.')} ${referenceSuggestion(attach.to, targets, 'Set attach.to to instance_id.socket_id.')}`,
    /** `ownSockets` are `instance.socket`; `targets` are `structure/instance.socket` addresses. */
    structureAttachment: (attach: Attachment, ownSockets: string[], targets: string[]): string =>
      `${referenceSuggestion(attach.socket, ownSockets, 'Set attach.socket to own_instance.socket.')} ${referenceSuggestion(attach.to, targets, 'Set attach.to to other_structure/instance.socket.')}`,
    incompatibleTypes: (own: SocketSide, target: SocketSide): string =>
      `${accepts([target, own])} Use one of these types or update the compatibility rules in project.yaml.`,
    occupied: (own: SocketSide, target: SocketSide, occupied: string[]): string =>
      `Free ${occupied.join(' and ')} by removing its existing attachment, or choose another free socket; each permits one connection. ${accepts([target, own])}`,
    /** `targetDirectionY` is the Y component of the target Socket's map direction. */
    directions: (own: SocketSide, target: SocketSide, targetDirectionY: number): string =>
      `Choose an ${targetDirectionY > EPSILON ? 'own Socket facing down' : targetDirectionY < -EPSILON ? 'own Socket facing up' : 'own horizontal Socket'} to face ${target.instanceRef}.${target.socket.id}; a Y-axis rotation cannot align the current directions. ${accepts([target, own])}`,
  };
}
