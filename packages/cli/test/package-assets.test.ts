import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { syncTree } from '../../../scripts/sync-tree.mjs';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

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

it('F33 copies the editor build into the CLI package and never keeps a stale copy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-web-copy-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'web/dist'),
    destination = path.join(root, 'cli/web');
  await mkdir(path.join(source, 'static'), { recursive: true });
  await writeFile(path.join(source, 'index.html'), '<title>Fake editor build</title>');
  await writeFile(path.join(source, 'static/app.js'), 'console.log(1);');
  await syncTree(source, destination, { optional: true });
  expect(await readFile(path.join(destination, 'index.html'), 'utf8')).toBe(
    '<title>Fake editor build</title>',
  );
  expect(await readFile(path.join(destination, 'static/app.js'), 'utf8')).toBe('console.log(1);');
  // An identical copy is left untouched, so parallel pack tests do not race.
  const before = await modificationTimes(destination);
  await syncTree(source, destination, { optional: true });
  expect(await modificationTimes(destination)).toEqual(before);
  // A rebuilt editor replaces the copy, including removed files.
  await rm(path.join(source, 'static'), { recursive: true });
  await writeFile(path.join(source, 'index.html'), '<title>Rebuilt editor</title>');
  await syncTree(source, destination, { optional: true });
  expect(await readdir(destination)).toEqual(['index.html']);
  expect(await readFile(path.join(destination, 'index.html'), 'utf8')).toBe(
    '<title>Rebuilt editor</title>',
  );
  // Without a build the copy goes away; the templates, which are required, must exist.
  await rm(source, { recursive: true });
  await syncTree(source, destination, { optional: true });
  await expect(stat(destination)).rejects.toThrow();
  await expect(syncTree(source, destination)).rejects.toThrow();
});

it('F33 packs the editor build with the CLI package', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { files: string[] };
  expect(metadata.files).toContain('web');
  const ignored = await readFile(new URL('../../../.gitignore', import.meta.url), 'utf8');
  expect(ignored.split(/\r?\n/)).toContain('packages/cli/web/');
});
