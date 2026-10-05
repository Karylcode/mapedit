/** Object references identify placed objects, never Module definitions or Sockets. */
export type ParsedObjectRef =
  | { kind: 'structure'; structureId: string }
  | { kind: 'module'; structureId: string; instanceId: string }
  | { kind: 'marker'; markerId: string };

const identifier = '[A-Za-z][A-Za-z0-9_-]*';
const validId = new RegExp(`^${identifier}$`);
const structurePattern = new RegExp(`^structure:(${identifier})$`);
const modulePattern = new RegExp(`^module:(${identifier})/(${identifier})$`);
const markerPattern = new RegExp(`^marker:(${identifier})$`);

function fullMatch(pattern: RegExp, value: string): RegExpExecArray | null {
  const match = pattern.exec(value);
  return match?.[0] === value ? match : null;
}

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && fullMatch(validId, value) !== null;
}

function checkedId(id: string): string {
  if (!isObjectId(id))
    throw new Error(`Invalid object id "${id}". Use a letter followed by letters, digits, _ or -.`);
  return id;
}

export function structureRef(id: string): string {
  return `structure:${checkedId(id)}`;
}

export function moduleRef(structureId: string, instanceId: string): string {
  return `module:${checkedId(structureId)}/${checkedId(instanceId)}`;
}

export function markerRef(id: string): string {
  return `marker:${checkedId(id)}`;
}

/** Parse only complete protocol references; bare ids and Socket addresses are rejected. */
export function parseObjectRef(ref: string): ParsedObjectRef | undefined {
  const structure = fullMatch(structurePattern, ref);
  if (structure) return { kind: 'structure', structureId: structure[1]! };
  const module = fullMatch(modulePattern, ref);
  if (module) return { kind: 'module', structureId: module[1]!, instanceId: module[2]! };
  const marker = fullMatch(markerPattern, ref);
  if (marker) return { kind: 'marker', markerId: marker[1]! };
  return undefined;
}
