import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
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
/** The CLI as `pnpm build` (or `pnpm typecheck`) compiles it. */
const cli = join(repo, 'packages/cli/dist/index.js');

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Whether packages/web/dist holds this very build; Vite names its files by their content. */
async function isPublished(site: string): Promise<boolean> {
  const page = (folder: string) =>
    readFile(join(folder, 'index.html'), 'utf8').catch(() => undefined);
  const [published, fresh] = await Promise.all([page(SERVER_WEB_ROOT), page(site)]);
  return published !== undefined && published === fresh;
}

/**
 * Put a build where `pnpm build` leaves it, packages/web/dist, swapping out
 * an older one in one step so a server reading it never finds it half written.
 */
async function publishBuild(site: string): Promise<void> {
  const next = `${SERVER_WEB_ROOT}.next-${process.pid}`;
  const old = `${SERVER_WEB_ROOT}.old-${process.pid}`;
  await rm(next, { recursive: true, force: true });
  await cp(site, next, { recursive: true });
  const had = await exists(SERVER_WEB_ROOT);
  // Windows may briefly refuse to rename a folder another process is reading.
  for (let attempt = 0; ; attempt++)
    try {
      if (had && (await exists(SERVER_WEB_ROOT))) await rename(SERVER_WEB_ROOT, old);
      await rename(next, SERVER_WEB_ROOT);
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((done) => setTimeout(done, 100));
    }
  await rm(old, { recursive: true, force: true });
}

it('builds the editor into the folder mapedit dev serves', async () => {
  const config = await resolveConfig(
    { root: webRoot, configFile: join(webRoot, 'vite.config.ts'), logLevel: 'error' },
    'build',
  );
  expect(resolve(config.root, config.build.outDir)).toBe(resolve(SERVER_WEB_ROOT));
});

describe.skipIf(!executable)('mapedit dev after pnpm build', () => {
  let project: string | undefined;
  let dev: ChildProcess | undefined;
  let url: string;
  let browser: Browser | undefined;
  /** Why this run cannot check the command, if it cannot. */
  let unbuilt: string | undefined;

  beforeAll(async () => {
    expect(await exists(cli), `${cli} is missing; run pnpm typecheck or pnpm build`).toBe(true);
    const site = (await buildWeb()).dir;
    if (!(await isPublished(site))) {
      // Packing the CLI copies packages/web/dist, so replacing it could disturb the
      // packed-CLI test running beside this one. CI runs test files one at a time.
      if (!process.env.CI) {
        unbuilt = 'packages/web/dist is missing or older than the sources; run pnpm build';
        return;
      }
      await publishBuild(site);
    }
    project = await mkdtemp(join(tmpdir(), 'mapedit-dev-command-'));
    await cp(join(repo, 'templates/project'), project, { recursive: true });
    const child = spawn(process.execPath, [cli, 'dev', '--port', '0'], {
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
  });

  it('serves the editor at /', async ({ skip }) => {
    if (unbuilt) skip(unbuilt);
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

  it('serves a working /render', async ({ skip }) => {
    if (unbuilt) skip(unbuilt);
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
