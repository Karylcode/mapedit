import type { Vec3, ViolationKind, ViolationView } from './index.js';

/** Which value is off the 0.5 m grid (protocol section 3). */
export type OffGridField =
  | 'structure_position'
  | 'structure_height'
  | 'module_position'
  | 'attached_module_position'
  | 'module_size'
  | 'socket_position'
  | 'marker_position'
  | 'marker_size';
/** Which angle breaks its rotation step (protocol section 3). */
export type RotationField =
  'structure' | 'structure_attachment' | 'module' | 'attached_module' | 'socket' | 'marker';
/** Map edges: north is z = 0, south is z = size.z, west is x = 0, east is x = size.x. */
export type MapEdge = 'north' | 'south' | 'east' | 'west';
export type MissingReferenceReason =
  | 'unknown_module'
  | 'unknown_socket_type'
  | 'unknown_material'
  | 'unknown_marker_type'
  | 'unresolved_attachment'
  | 'attachment_cycle'
  | 'unknown_object'
  | 'immovable_object';
export type SocketProblem = 'types' | 'occupied' | 'directions';

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
    step: 15 | 90;
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
  overlap: ViolationSourceParams & { target: 'module' | 'terrain'; estimated?: true };
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
      oneOf('north', 'south', 'east', 'west')(item.edge) &&
      isNumber(item.distance) &&
      (item.distance as number) > 0,
  );
const fields: { [K in ViolationKind]: Record<string, [Check, 'required' | 'optional']> } = {
  off_grid: {
    field: [
      oneOf(
        'structure_position',
        'structure_height',
        'module_position',
        'attached_module_position',
        'module_size',
        'socket_position',
        'marker_position',
        'marker_size',
      ),
      'required',
    ],
    values: [isNumbers, 'required'],
    nearest: [isNumbers, 'required'],
    moduleType: [isString, 'optional'],
  },
  bad_rotation: {
    field: [
      oneOf('structure', 'structure_attachment', 'module', 'attached_module', 'socket', 'marker'),
      'required',
    ],
    rotation: [isNumber, 'required'],
    step: [oneOf(15, 90), 'required'],
    nearest: [isNumber, 'required'],
    moduleType: [isString, 'optional'],
  },
  out_of_bounds: {
    edges: [isEdges, 'required'],
    bounds: [isBounds, 'required'],
    size: [isSize, 'required'],
  },
  missing_reference: {
    reason: [
      oneOf(
        'unknown_module',
        'unknown_socket_type',
        'unknown_material',
        'unknown_marker_type',
        'unresolved_attachment',
        'attachment_cycle',
        'unknown_object',
        'immovable_object',
      ),
      'required',
    ],
    reference: [isString, 'required'],
    moduleType: [isString, 'optional'],
  },
  incompatible_socket: {
    reason: [oneOf('types', 'occupied', 'directions'), 'required'],
    socketA: [isString, 'required'],
    socketB: [isString, 'required'],
    typeA: [isString, 'required'],
    typeB: [isString, 'required'],
  },
  overlap: {
    target: [oneOf('module', 'terrain'), 'required'],
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
