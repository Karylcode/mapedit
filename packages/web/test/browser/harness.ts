import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { build } from 'vite';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ObjectRef } from '@mapedit/protocol';

const webRoot = fileURLToPath(new URL('../../', import.meta.url));

/** The same system browsers the backend's screenshot service uses. */
export async function findBrowser(): Promise<string | undefined> {
  const candidates =
    process.platform === 'win32'
      ? [
          join(
            process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
            'Microsoft/Edge/Application/msedge.exe',
          ),
          join(
            process.env['PROGRAMFILES'] ?? 'C:/Program Files',
            'Google/Chrome/Application/chrome.exe',
          ),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/usr/bin/microsoft-edge',
          ];
  for (const path of candidates)
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return path;
  return undefined;
}

/**
 * `expect.poll` with room for slow machines: CI runners draw WebGL in
 * software and rebuild real projects more slowly than a desktop.
 */
export function poll<T>(read: () => T | Promise<T>, options: { timeout?: number } = {}) {
  return expect.poll(read, { interval: 50, ...options, timeout: options.timeout ?? 15_000 });
}

/** Build the production bundle into a temporary folder the backend can serve. */
export async function buildWeb(): Promise<{ dir: string; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'mapedit-web-'));
  await build({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    logLevel: 'error',
    build: { outDir: dir, emptyOutDir: true },
  });
  return { dir, dispose: () => rm(dir, { recursive: true, force: true }) };
}

export function launch(executablePath: string): Promise<Browser> {
  // Machines without a GPU (CI) need the software WebGL fallback.
  return chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader'] });
}

/**
 * Open the editor and wait until the map's models are drawn. `prepare` runs
 * before the page loads, e.g. to route its WebSocket.
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
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  (page as Page & { errors: string[] }).errors = errors;
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
