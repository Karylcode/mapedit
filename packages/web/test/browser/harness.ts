import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** Open the editor and wait until the map's models are drawn. */
export async function openEditor(browser: Browser, url: string, locale = 'en-US'): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale,
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  (page as Page & { errors: string[] }).errors = errors;
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

/** Editor state as plain data. */
export function editorState<T>(page: Page, pick: (editor: EditorHandle) => T): Promise<T> {
  return page.evaluate(`(${pick.toString()})(globalThis.mapeditEditor)`) as Promise<T>;
}

/** Shape of `window.mapeditEditor`, loosely typed for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EditorHandle = any;
