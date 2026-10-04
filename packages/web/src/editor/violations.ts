import {
  violationParamsProblems,
  type MapEdge,
  type TypedViolationView,
  type ViolationKind,
  type ViolationView,
} from '@mapedit/protocol';
import type { MessageKey, Translator } from '../i18n/i18n.js';
import type { SnapshotIndex } from '../scene/snapshot-index.js';
import { objectNames } from './describe.js';

export const VIOLATION_KINDS: readonly ViolationKind[] = [
  'overlap',
  'incompatible_socket',
  'unsupported',
  'off_grid',
  'bad_rotation',
  'out_of_bounds',
  'missing_reference',
];

const OPPOSITE: Record<MapEdge, MapEdge> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** Fields written directly in a file; computed ones are fixed elsewhere, so keep the backend's advice. */
const WRITTEN_POSITIONS = new Set([
  'structure_position',
  'structure_height',
  'module_position',
  'module_size',
  'socket_position',
  'marker_position',
  'marker_size',
]);
const WRITTEN_ROTATIONS = new Set(['structure', 'module', 'socket', 'marker']);

/** The interface-language name of a violation kind, such as 穿模 for overlap. */
export function violationKindName(kind: ViolationKind, t: Translator): string {
  return t(`violation.${kind}` as MessageKey);
}

/** A short title for one violation in the interface language. */
export function violationTitle(violation: ViolationView, t: Translator): string {
  return violationKindName(violation.kind, t);
}

const number = (value: number) => String(Math.round(value * 1000) / 1000);
const numbers = (values: readonly number[]) =>
  values.length === 1 ? number(values[0]!) : `(${values.map(number).join(', ')})`;
/** `module:house/wall_n.top` reads as `wall_n.top`. */
const socketName = (socket: string) => socket.replace(/^module:[^/]+\//, '');

/** Params that match protocol section 3, narrowed by kind; otherwise undefined. */
function typed(violation: ViolationView): TypedViolationView | undefined {
  return violationParamsProblems(violation).length
    ? undefined
    : (violation as TypedViolationView);
}

/** What is wrong, in the interface language, from the violation's params. */
export function violationMessage(violation: ViolationView, t: Translator): string {
  const v = typed(violation);
  if (!v) return violation.message;
  switch (v.kind) {
    case 'off_grid':
      return t('violation.off_grid.message', {
        field: t(`violation.field.${v.params.field}` as MessageKey),
        values: numbers(v.params.values),
      });
    case 'bad_rotation':
      return t('violation.bad_rotation.message', {
        field: t(`violation.rotationField.${v.params.field}` as MessageKey),
        rotation: number(v.params.rotation),
        step: v.params.step,
      });
    case 'out_of_bounds':
      return t('violation.out_of_bounds.message', {
        edges: v.params.edges
          .map(({ edge, distance }) =>
            t('violation.edgeDistance', {
              edge: t(`direction.${edge}` as MessageKey),
              distance: number(distance),
            }),
          )
          .join(t('list.separator')),
      });
    case 'missing_reference':
      return t(`violation.missing.${v.params.reason}` as MessageKey, {
        reference: v.params.reference,
      });
    case 'incompatible_socket':
      return t(`violation.socket.${v.params.reason}` as MessageKey, {
        typeA: v.params.typeA,
        typeB: v.params.typeB,
        socketA: socketName(v.params.socketA),
        socketB: socketName(v.params.socketB),
      });
    case 'overlap':
      return t(
        v.params.target === 'terrain' ? 'violation.overlap.terrain' : 'violation.overlap.module',
      );
    case 'unsupported':
      return t('violation.unsupported.message');
  }
}

/**
 * How to fix it. Grid, rotation and bounds fixes follow from the params and
 * are translated; other advice is the backend's English suggestion.
 */
export function violationSuggestion(violation: ViolationView, t: Translator): string | undefined {
  const v = typed(violation);
  if (v?.kind === 'off_grid' && WRITTEN_POSITIONS.has(v.params.field))
    return t('violation.off_grid.fix', { nearest: numbers(v.params.nearest) });
  if (v?.kind === 'bad_rotation' && WRITTEN_ROTATIONS.has(v.params.field))
    return t('violation.bad_rotation.fix', { nearest: number(v.params.nearest) });
  if (v?.kind === 'out_of_bounds' && v.params.edges.length)
    return t('violation.out_of_bounds.fix', {
      moves: v.params.edges
        .map(({ edge, distance }) =>
          t('violation.move', {
            direction: t(`direction.${OPPOSITE[edge]}` as MessageKey),
            distance: number(distance),
          }),
        )
        .join(t('list.separator')),
    });
  return violation.suggestion;
}

export interface ViolationText {
  title: string;
  /** Names of the objects involved. */
  objects: string;
  message: string;
  suggestion?: string;
  /** `file:line` for violations that come from a file. */
  source?: string;
}

export function violationText(
  violation: ViolationView,
  index: SnapshotIndex | undefined,
  t: Translator,
): ViolationText {
  const { file, line } = violation.params as { file?: unknown; line?: unknown };
  const suggestion = violationSuggestion(violation, t);
  return {
    title: violationTitle(violation, t),
    objects: objectNames(violation.refs, index, t),
    message: violationMessage(violation, t),
    ...(suggestion ? { suggestion } : {}),
    ...(typeof file === 'string'
      ? { source: typeof line === 'number' ? `${file}:${line}` : file }
      : {}),
  };
}
