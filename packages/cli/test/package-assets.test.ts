import { afterEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
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

it('F33 keeps the copied editor build out of lint, but still lints the template copy', async () => {
  const { ESLint } = await import('eslint');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const eslint = new ESLint({ cwd: root });
  expect(await eslint.isPathIgnored(path.join(root, 'packages/cli/web/static/app.js'))).toBe(true);
  // The template copy is the only lint coverage of the project templates' model.ts files.
  expect(
    await eslint.isPathIgnored(
      path.join(root, 'packages/cli/templates/project/modules/wall/model.ts'),
    ),
  ).toBe(false);
});

it('F37 finds packages whose sources changed after their last build', async () => {
  const { staleBuilds } = await import('../../../scripts/build-freshness.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-freshness-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const write = async (file: string, time: number) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), file);
    await utimes(path.join(root, file), time, time);
  };
  // fresh was built after its last edit; stale was edited after; unbuilt has no build.
  await write('packages/fresh/src/nested/index.ts', 1_000);
  await write('packages/fresh/tsconfig.tsbuildinfo', 2_000);
  await write('packages/stale/src/index.ts', 1_000);
  await write('packages/stale/src/nested/late.ts', 3_000);
  await write('packages/stale/tsconfig.tsbuildinfo', 2_000);
  await write('packages/unbuilt/src/index.ts', 1_000);
  expect(await staleBuilds(root, ['fresh', 'stale', 'unbuilt'])).toEqual(['stale', 'unbuilt']);
});

it('F44 runs CI once per change: pushes to main, and pull requests', async () => {
  const { createRequire } = await import('node:module');
  const { parse } = createRequire(new URL('../../core/package.json', import.meta.url))(
    'yaml',
  ) as typeof import('yaml');
  const workflow = parse(
    await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  ) as {
    on: { push: { branches: string[] }; pull_request: unknown };
    jobs: { verify: { strategy: { matrix: { os: string[]; node: number[] } } } };
  };
  expect(workflow.on.push.branches).toEqual(['main']);
  expect(workflow.on).toHaveProperty('pull_request');
  // The user keeps the full Windows/Ubuntu x Node 22/24 matrix.
  expect(workflow.jobs.verify.strategy.matrix).toEqual({
    os: ['ubuntu-latest', 'windows-latest'],
    node: [22, 24],
  });
});
