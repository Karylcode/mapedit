import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

async function modificationTimes(directory: string): Promise<Record<string, bigint>> {
  const result: Record<string, bigint> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await modificationTimes(filename));
    else result[filename] = (await stat(filename, { bigint: true })).mtimeNs;
  }
  return result;
}

it('F12 repeated build/prepack preparation leaves identical shared templates untouched', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const paths = ['templates/project', 'packages/cli/templates/project'];
  const before = await Promise.all(
    paths.map((directory) => modificationTimes(path.join(root, directory))),
  );
  await promisify(execFile)(process.execPath, [path.join(root, 'scripts/prepare-cli.mjs')], {
    windowsHide: true,
  });
  const after = await Promise.all(
    paths.map((directory) => modificationTimes(path.join(root, directory))),
  );
  expect(after).toEqual(before);
});
