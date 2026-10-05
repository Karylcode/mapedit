import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { resolveConfig } from 'vite';
import { SERVER_WEB_ROOT } from '@mapedit/server';
import type { RenderWindow } from '@mapedit/protocol';
import {
  buildWeb,
  findBrowser,
  launch,
  openEditor,
  pageErrors,
  watchErrors,
  webRoot,
} from './browser/harness.js';

const executable = await findBrowser();
const repo = fileURLToPath(new URL('../../../', import.meta.url));

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * Links each package of a node_modules folder to its real folder, as pnpm
 * does, so Node finds every package as a link in a real folder. On the Windows
 * runners on GitHub, Node does not see a package link inside a linked
 * node_modules folder as a folder, and cannot find the package.
 */
async function linkPackages(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) await linkPackages(join(from, name), join(to, name));
    else await symlink(await realpath(join(from, name)), join(to, name), 'junction');
  }
}

/**
 * The CLI and server as `pnpm build` compiles them, copied into a temporary
 * repository layout whose packages/web/dist is this build: `mapedit dev` serves
 * the build it finds there, and the real packages/web/dist is never touched.
 * Their dependencies are the repository's own, linked in.
 */
async function layoutWith(site: string): Promise<{ root: string; cli: string }> {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-dev-layout-'));
  const packages = join(root, 'packages');
  for (const name of ['server', 'cli']) {
    const compiled = join(repo, 'packages', name, 'dist');
    expect(await exists(compiled), `${compiled} is missing; run pnpm build`).toBe(true);
    await cp(compiled, join(packages, name, 'dist'), { recursive: true });
    await cp(join(repo, 'packages', name, 'package.json'), join(packages, name, 'package.json'));
  }
  await linkPackages(
    join(repo, 'packages/server/node_modules'),
    join(packages, 'server/node_modules'),
  );
  // The CLI finds the copied server, and the repository's core.
  await mkdir(join(packages, 'cli/node_modules/@mapedit'), { recursive: true });
  await symlink(
    join(packages, 'server'),
    join(packages, 'cli/node_modules/@mapedit/server'),
    'junction',
  );
  await symlink(
    join(repo, 'packages/core'),
    join(packages, 'cli/node_modules/@mapedit/core'),
    'junction',
  );
  await cp(site, join(packages, 'web/dist'), { recursive: true });
  return { root, cli: join(packages, 'cli/dist/index.js') };
}

it('builds the editor into the folder mapedit dev serves', async () => {
  const config = await resolveConfig(
    { root: webRoot, configFile: join(webRoot, 'vite.config.ts'), logLevel: 'error' },
    'build',
  );
  expect(resolve(config.root, config.build.outDir)).toBe(resolve(SERVER_WEB_ROOT));
});

describe.skipIf(!executable)('mapedit dev after pnpm build', () => {
  let layout: { root: string; cli: string } | undefined;
  let project: string | undefined;
  let dev: ChildProcess | undefined;
  let url: string;
  let browser: Browser | undefined;

  beforeAll(async () => {
    layout = await layoutWith((await buildWeb()).dir);
    project = await mkdtemp(join(tmpdir(), 'mapedit-dev-command-'));
    await cp(join(repo, 'templates/project'), project, { recursive: true });
    const child = spawn(process.execPath, [layout.cli, 'dev', '--port', '0'], {
      cwd: project,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    dev = child;
    url = await new Promise<string>((done, fail) => {
      let output = '';
      child.stderr!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const listening = /listening at (http:\/\/\S+)/.exec(output);
        if (listening) done(listening[1]!);
      });
      child.on('exit', (code) => fail(new Error(`mapedit dev exited with ${code}: ${output}`)));
    });
    browser = await launch(executable!);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    const child = dev;
    if (child && child.exitCode === null) {
      const exited = new Promise((done) => child.once('exit', done));
      child.kill();
      await exited;
    }
    if (project) await rm(project, { recursive: true, force: true });
    // Removes the links themselves, not the repository folders they point to.
    if (layout) await rm(layout.root, { recursive: true, force: true });
  });

  it('serves the editor at /', async () => {
    const page = await openEditor(browser!, url);
    expect(await page.locator('.title-block').innerText()).toMatch(/My Mapedit Project/);
    expect(
      await page.evaluate(() => {
        const editor = (
          globalThis as unknown as {
            mapeditEditor: { store: { state: { scene: { structures: unknown[] } } } };
          }
        ).mapeditEditor;
        return editor.store.state.scene.structures.length;
      }),
    ).toBeGreaterThan(0);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });

  it('serves a working /render', async () => {
    const page = await browser!.newPage();
    watchErrors(page);
    await page.goto(`${url}/render?map=village`);
    await page.waitForFunction(
      () => (window as unknown as RenderWindow).mapeditRenderReady === true,
      undefined,
      { timeout: 30_000 },
    );
    const png = await page.evaluate(() =>
      (window as unknown as RenderWindow).mapeditRender({ views: ['top'], tileSize: 64 }),
    );
    expect(png).toMatch(/^data:image\/png;base64,/);
    expect(pageErrors(page)).toEqual([]);
    await page.close();
  });
});
