import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Compare resolved paths; callers resolve real paths first when following links. */
export function containsPath(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/** `text` with every absolute path inside `root` written relative to it, with forward slashes. */
export function projectRelativePaths(text: string, root: string): string {
  let result = text;
  for (const variant of new Set([root, root.replaceAll('\\', '/')])) {
    const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The root ends at a separator, a quote, a space or the end, never inside a longer name.
    result = result.replace(
      new RegExp(
        `${escaped}(?:[\\\\/]([^'"\\n]*)|(?=['"\\s]|$))`,
        process.platform === 'win32' ? 'gi' : 'g',
      ),
      (_match, rest?: string) => (rest ? rest.replaceAll('\\', '/') : '.'),
    );
  }
  return result;
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
