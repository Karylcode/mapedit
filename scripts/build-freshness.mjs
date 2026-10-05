import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** The latest modification time of the files under a directory, in milliseconds. */
async function newest(directory) {
  let latest = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    latest = Math.max(
      latest,
      entry.isDirectory() ? await newest(file) : (await stat(file)).mtimeMs,
    );
  }
  return latest;
}

/**
 * Packages whose sources changed after their last TypeScript build, so the dist folders
 * that packing uses are out of date. A package that was never built counts as stale.
 */
export async function staleBuilds(repository, folders) {
  const stale = [];
  for (const folder of folders) {
    const root = path.join(repository, 'packages', folder);
    const built = await stat(path.join(root, 'tsconfig.tsbuildinfo')).then(
      (value) => value.mtimeMs,
      () => 0,
    );
    if ((await newest(path.join(root, 'src'))) > built) stale.push(folder);
  }
  return stale;
}
