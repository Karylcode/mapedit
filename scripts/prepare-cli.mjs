import './generate-authoring.mjs';
import { cp, mkdir, rm, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = fileURLToPath(new URL('templates/project/', root));
// A fixed folder inside the CLI package, packed through its "files" list.
const destination = fileURLToPath(new URL('packages/cli/templates/project/', root));
async function sameTree(left, right) {
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
        `CLI templates must contain only directories and regular files: ${leftChild}`,
      );
  }
  return true;
}
// A normal build followed by parallel pack/init tests leaves shared inputs untouched.
if (!(await sameTree(source, destination))) {
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
