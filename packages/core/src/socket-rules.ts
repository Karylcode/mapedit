import type { SocketType } from './domain.js';
import { compareText } from './math.js';

/** Compatibility is symmetric: either declared direction permits a connection. */
export function socketTypesCompatible(
  types: Readonly<Record<string, SocketType>>,
  a: string,
  b: string,
): boolean {
  return Boolean(types[a]?.compatibleWith.includes(b) || types[b]?.compatibleWith.includes(a));
}

export function compatibleSocketTypes(
  types: Readonly<Record<string, SocketType>>,
  type: string,
): string[] {
  return Object.keys(types)
    .filter((other) => socketTypesCompatible(types, type, other))
    .sort(compareText);
}
