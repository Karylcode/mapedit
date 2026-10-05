import { cp, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Whether two directory trees hold the same directories and identical regular files. */
export async function sameTree(left, right) {
  const expected = await readdir(left, { withFileTypes: true });
  let actual;
  try {
    actual = await readdir(right, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
  if (expected.length !== actual.length) return false;
  for (const entry of expected) {
    const other = actual.find((candidate) => candidate.name === entry.name);
    if (!other || entry.isDirectory() !== other.isDirectory() || entry.isFile() !== other.isFile())
      return false;
    const leftChild = path.join(left, entry.name),
      rightChild = path.join(right, entry.name);
    if (entry.isDirectory()) {
      if (!(await sameTree(leftChild, rightChild))) return false;
    } else if (entry.isFile()) {
      if (!(await readFile(leftChild)).equals(await readFile(rightChild))) return false;
    } else
      throw new Error(
        `Copied folders must contain only directories and regular files: ${leftChild}`,
      );
  }
  return true;
}

/**
 * Make `destination` an exact copy of `source`, and leave it untouched when it already is
 * one. Without an `optional` source the copy is removed, so a package never carries a
 * stale build; a missing required source is an error.
 */
export async function syncTree(source, destination, { optional = false } = {}) {
  const present = await readdir(source).then(
    () => true,
    (error) => {
      if (optional && error.code === 'ENOENT') return false;
      throw error;
    },
  );
  if (!present) {
    await rm(destination, { recursive: true, force: true });
    return;
  }
  if (await sameTree(source, destination)) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
