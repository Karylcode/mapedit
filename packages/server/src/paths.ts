import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Compare resolved paths; callers resolve real paths first when following links. */
export function containsPath(root: string, target: string): boolean {
  const inside = relative(root, target);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
}

/**
 * The spellings of an existing project root that paths in errors may use: as given, with links
 * resolved (`realpathSync`) and as the system resolves it (`realpathSync.native`, which on
 * Windows also writes short 8.3 names such as RUNNER~1 in full).
 */
export function rootSpellings(root: string): string[] {
  const given = resolve(root);
  return [...new Set([given, realpathSync(given), realpathSync.native(given)])];
}

/**
 * `text` with every absolute path inside the project written relative to it, with forward
 * slashes. `roots` is the project root, or every spelling of it (see rootSpellings).
 */
export function projectRelativePaths(text: string, roots: string | readonly string[]): string {
  let result = text;
  const spellings = (typeof roots === 'string' ? [roots] : roots).flatMap((root) => [
    root,
    root.replaceAll('\\', '/'),
  ]);
  // Longest first, so a spelling inside another, as /tmp/p is inside /private/tmp/p, never cuts it.
  for (const variant of [...new Set(spellings)].sort((a, b) => b.length - a.length)) {
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
