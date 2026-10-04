import type { Vec3, ViolationKind, ViolationView } from './index.js';

// Each enumeration is one list, in protocol section 3 order; its type derives from it.
/** Which value is off the 0.5 m grid (protocol section 3). */
export const OFF_GRID_FIELDS = [
  'structure_position',
  'structure_height',
  'module_position',
  'attached_module_position',
  'module_size',
  'socket_position',
  'marker_position',
  'marker_size',
] as const;
export type OffGridField = (typeof OFF_GRID_FIELDS)[number];
/** Which angle breaks its rotation step (protocol section 3). */
export const ROTATION_FIELDS = [
  'structure',
  'structure_attachment',
  'module',
  'attached_module',
  'socket',
  'marker',
] as const;
export type RotationField = (typeof ROTATION_FIELDS)[number];
export const ROTATION_STEPS = [15, 90] as const;
export type RotationStep = (typeof ROTATION_STEPS)[number];
/** Map edges: north is z = 0, south is z = size.z, west is x = 0, east is x = size.x. */
export const MAP_EDGES = ['north', 'south', 'east', 'west'] as const;
export type MapEdge = (typeof MAP_EDGES)[number];
export const MISSING_REFERENCE_REASONS = [
  'unknown_module',
  'unknown_socket_type',
  'unknown_material',
  'unknown_marker_type',
  'unresolved_attachment',
  'attachment_cycle',
  'unknown_object',
  'immovable_object',
] as const;
export type MissingReferenceReason = (typeof MISSING_REFERENCE_REASONS)[number];
export const SOCKET_PROBLEMS = ['types', 'occupied', 'directions'] as const;
export type SocketProblem = (typeof SOCKET_PROBLEMS)[number];
export const OVERLAP_TARGETS = ['module', 'terrain'] as const;
export type OverlapTarget = (typeof OVERLAP_TARGETS)[number];

/** File-backed violations carry their source; editor-only violations do not. */
export interface ViolationSourceParams {
  file?: string;
  line?: number;
}
/** The params of each violation kind, as tabulated in protocol section 3. */
export interface ViolationParamsByKind {
  off_grid: ViolationSourceParams & {
    field: OffGridField;
    values: number[];
    nearest: number[];
    moduleType?: string;
  };
  bad_rotation: ViolationSourceParams & {
    field: RotationField;
    rotation: number;
    step: RotationStep;
    nearest: number;
    moduleType?: string;
  };
  out_of_bounds: ViolationSourceParams & {
    edges: { edge: MapEdge; distance: number }[];
    bounds: { min: Vec3; max: Vec3 };
    size: { x: number; z: number };
  };
  missing_reference: ViolationSourceParams & {
    reason: MissingReferenceReason;
    reference: string;
    moduleType?: string;
  };
  incompatible_socket: ViolationSourceParams & {
    reason: SocketProblem;
    socketA: string;
    socketB: string;
    typeA: string;
    typeB: string;
  };
  /** `estimated` marks a module overlap estimated from bounding boxes after 200 exact ones. */
  overlap: ViolationSourceParams & { target: OverlapTarget; estimated?: true };
  unsupported: ViolationSourceParams;
}
/** A ViolationView whose params are typed by its kind; narrow it with `switch (kind)`. */
export type TypedViolationView = {
  [K in ViolationKind]: Omit<ViolationView, 'kind' | 'params'> & {
    kind: K;
    params: ViolationParamsByKind[K];
  };
}[ViolationKind];

type Check = (value: unknown) => boolean;
const isString: Check = (value) => typeof value === 'string';
const isNumber: Check = (value) => typeof value === 'number' && Number.isFinite(value);
const isNumbers: Check = (value) => Array.isArray(value) && value.every(isNumber);
const isVec3: Check = (value) => isNumbers(value) && (value as number[]).length === 3;
const oneOf =
  (...allowed: unknown[]): Check =>
  (value) =>
    allowed.includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBounds: Check = (value) => isRecord(value) && isVec3(value.min) && isVec3(value.max);
const isSize: Check = (value) => isRecord(value) && isNumber(value.x) && isNumber(value.z);
const isEdges: Check = (value) =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      oneOf(...MAP_EDGES)(item.edge) &&
      isNumber(item.distance) &&
      (item.distance as number) > 0,
  );
const fields: { [K in ViolationKind]: Record<string, [Check, 'required' | 'optional']> } = {
  off_grid: {
    field: [oneOf(...OFF_GRID_FIELDS), 'required'],
    values: [isNumbers, 'required'],
    nearest: [isNumbers, 'required'],
    moduleType: [isString, 'optional'],
  },
  bad_rotation: {
    field: [oneOf(...ROTATION_FIELDS), 'required'],
    rotation: [isNumber, 'required'],
    step: [oneOf(...ROTATION_STEPS), 'required'],
    nearest: [isNumber, 'required'],
    moduleType: [isString, 'optional'],
  },
  out_of_bounds: {
    edges: [isEdges, 'required'],
    bounds: [isBounds, 'required'],
    size: [isSize, 'required'],
  },
  missing_reference: {
    reason: [oneOf(...MISSING_REFERENCE_REASONS), 'required'],
    reference: [isString, 'required'],
    moduleType: [isString, 'optional'],
  },
  incompatible_socket: {
    reason: [oneOf(...SOCKET_PROBLEMS), 'required'],
    socketA: [isString, 'required'],
    socketB: [isString, 'required'],
    typeA: [isString, 'required'],
    typeB: [isString, 'required'],
  },
  overlap: {
    target: [oneOf(...OVERLAP_TARGETS), 'required'],
    estimated: [oneOf(true), 'optional'],
  },
  unsupported: {},
};

/**
 * List how a violation's params differ from the protocol section 3 table; an empty list
 * means they match. Unknown keys are reported too, so producers cannot drift silently.
 */
export function violationParamsProblems(violation: ViolationView): string[] {
  const problems: string[] = [];
  const expected = fields[violation.kind];
  if (!expected) return [`Unknown violation kind "${violation.kind}".`];
  const params = violation.params as Record<string, unknown>;
  if ('file' in params !== 'line' in params) problems.push('file and line must appear together.');
  if ('file' in params && !isString(params.file)) problems.push('file must be a string.');
  if ('line' in params && !(Number.isInteger(params.line) && (params.line as number) > 0))
    problems.push('line must be a positive integer.');
  for (const [key, [check, presence]] of Object.entries(expected)) {
    if (!(key in params)) {
      if (presence === 'required') problems.push(`${key} is required.`);
    } else if (!check(params[key])) problems.push(`${key} has an invalid value.`);
  }
  for (const key of Object.keys(params))
    if (key !== 'file' && key !== 'line' && !(key in expected))
      problems.push(`${key} is not a documented ${violation.kind} param.`);
  return problems;
}
