import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Compare resolved paths; callers resolve real paths first when following links. */
export function containsPath(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** The first directory that holds a built editor (an index.html), if any. */
export async function findWebRoot(...candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates)
    if (
      await stat(join(candidate, 'index.html')).then(
        (value) => value.isFile(),
        () => false,
      )
    )
      return candidate;
  return undefined;
}
