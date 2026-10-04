import { isAbsolute, relative, sep } from 'node:path';

/** Compare resolved paths; callers resolve real paths first when following links. */
export function containsPath(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}
