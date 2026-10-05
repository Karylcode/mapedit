import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, inject } from 'vitest';
import { build } from 'vite';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ObjectRef } from '@mapedit/protocol';
import { findBrowser as findSystemBrowser, SCREENSHOT_BROWSER_ARGS } from '@mapedit/server';

export const webRoot = fileURLToPath(new URL('../../', import.meta.url));

declare module 'vitest' {
  export interface ProvidedContext {
    /** Where `buildWeb` puts the production build shared by one test run (global-setup.ts). */
    webBuild: string;
  }
}

/**
 * The system browser the backend's screenshot service would use. Without one
 * the browser tests are skipped, except on CI (`CI` set), where they must run.
 */
export async function findBrowser(): Promise<string | undefined> {
  const found = await findSystemBrowser();
  if (!found && process.env.CI)
    throw new Error('No Edge or Chrome was found; on CI the browser tests must run.');
  return found;
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * `expect.poll` with room for slow machines: CI runners draw WebGL in
 * software and rebuild real projects more slowly than a desktop.
 */
export function poll<T>(read: () => T | Promise<T>, options: { timeout?: number } = {}) {
  return expect.poll(read, { interval: 50, ...options, timeout: options.timeout ?? 15_000 });
}

/**
 * The production bundle, in a folder the backend can serve. It is built once
 * per test run into the folder the global setup provides: the first test to
 * ask builds it, and tests in other workers wait for it. The global teardown
 * removes it, so `dispose` has nothing left to do.
 */
export async function buildWeb(): Promise<{ dir: string; dispose(): Promise<void> }> {
  const shared = inject('webBuild') ?? (await mkdtemp(join(tmpdir(), 'mapedit-web-')));
  const site = join(shared, 'site');
  const done = join(shared, 'done');
  const failed = join(shared, 'failed');
  let builder = false;
  if (!(await exists(done)))
    builder = await mkdir(join(shared, 'lock')).then(
      () => true,
      () => false,
    );
  if (builder) {
    try {
      await build({
        root: webRoot,
        configFile: join(webRoot, 'vite.config.ts'),
        logLevel: 'error',
        build: { outDir: site, emptyOutDir: true },
      });
      await writeFile(done, '');
    } catch (error) {
      await writeFile(failed, String(error));
      throw error;
    }
  }
  for (const deadline = Date.now() + 120_000; !(await exists(done));) {
    if (await exists(failed))
      throw new Error(`The shared web build failed: ${await readFile(failed, 'utf8')}`);
    if (Date.now() > deadline) throw new Error('Timed out waiting for the shared web build.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { dir: site, dispose: async () => {} };
}

export function launch(executablePath: string): Promise<Browser> {
  // The backend's flags, including the software WebGL fallback for machines without a GPU.
  return chromium.launch({ executablePath, headless: true, args: [...SCREENSHOT_BROWSER_ARGS] });
}

const errorsOf = new WeakMap<Page, string[]>();

/**
 * Collect a page's uncaught errors and its console errors; three.js reports
 * shader and WebGL failures only on the console.
 */
export function watchErrors(page: Page): void {
  const errors: string[] = [];
  errorsOf.set(page, errors);
  page.on('pageerror', (error) => errors.push(`page error: ${String(error)}`));
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(`console error: ${message.text()} (${message.location().url})`);
  });
}

/** Errors collected by `watchErrors` so far. */
export function pageErrors(page: Page): string[] {
  return [...(errorsOf.get(page) ?? [])];
}

/**
 * Open the editor and wait until the map's models are drawn. `prepare` runs
 * before the page loads, e.g. to route its WebSocket. Errors are collected
 * for `pageErrors`.
 */
export async function openEditor(
  browser: Browser,
  url: string,
  locale = 'en-US',
  prepare?: (page: Page) => Promise<void>,
): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale,
  });
  watchErrors(page);
  await prepare?.(page);
  await page.goto(url);
  await waitForEditor(page);
  return page;
}

export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const editor = (
        globalThis as {
          mapeditEditor?: { store: { state: { scene?: unknown; loadingMap: boolean } } };
        }
      ).mapeditEditor;
      return Boolean(editor?.store.state.scene) && editor?.store.state.loadingMap === false;
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Page coordinates of the center of an object's outline box. */
export async function screenPoint(page: Page, ref: ObjectRef): Promise<{ x: number; y: number }> {
  return page.evaluate((target) => {
    const editor = (globalThis as unknown as { mapeditEditor: EditorHandle }).mapeditEditor;
    const viewport = editor.viewport;
    viewport.overview.apply(viewport.camera);
    const bounds = editor.map.boundsOf(target);
    if (!bounds) throw new Error(`No bounds for ${target}`);
    const point = bounds.getCenter(bounds.min.clone()).project(viewport.camera);
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: ((point.x + 1) / 2) * rect.width + rect.left,
      y: ((1 - point.y) / 2) * rect.height + rect.top,
    };
  }, ref);
}

/** Look straight down at the map, so objects at different places never hide each other. */
export async function lookDown(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (globalThis as unknown as { mapeditEditor: EditorHandle }).mapeditEditor;
    const overview = editor.viewport.overview;
    overview.frameMap(editor.viewport.camera.fov, editor.viewport.camera.aspect);
    overview.pitch = 89;
    editor.viewport.invalidate();
  });
  await page.waitForTimeout(100);
}

/** Page coordinates of a map position. */
export async function projectPoint(
  page: Page,
  position: [number, number, number],
): Promise<{ x: number; y: number }> {
  return page.evaluate((target) => {
    const editor = (globalThis as unknown as { mapeditEditor: EditorHandle }).mapeditEditor;
    const viewport = editor.viewport;
    viewport.overview.apply(viewport.camera);
    const point = viewport.camera.position
      .clone()
      .set(...target)
      .project(viewport.camera);
    const rect = viewport.renderer.domElement.getBoundingClientRect();
    return {
      x: ((point.x + 1) / 2) * rect.width + rect.left,
      y: ((1 - point.y) / 2) * rect.height + rect.top,
    };
  }, position);
}

/** Drag with the left button in small steps, like a person would. */
export async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  during?: () => Promise<void>,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(200);
  await during?.();
  await page.mouse.up();
}

/** Editor state as plain data. */
export function editorState<T>(page: Page, pick: (editor: EditorHandle) => T): Promise<T> {
  return page.evaluate(`(${pick.toString()})(globalThis.mapeditEditor)`) as Promise<T>;
}

/** Shape of `window.mapeditEditor`, loosely typed for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EditorHandle = any;
