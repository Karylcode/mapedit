import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mockScene } from '../src/mock.js';
import { SCREENSHOT_BROWSER_ARGS, ScreenshotService, findBrowser } from '../src/screenshot.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** Serves the test render page and a scene, like the editor server does for /render. */
async function renderServer(): Promise<string> {
  const html = await readFile(new URL('./fixtures/render/index.html', import.meta.url));
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/api/scene')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(mockScene()));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return `http://127.0.0.1:${address.port}`;
}

it('lets the headless browser fall back to software WebGL on machines without a GPU', () => {
  expect(SCREENSHOT_BROWSER_ARGS).toContain('--enable-unsafe-swiftshader');
  expect(SCREENSHOT_BROWSER_ARGS).toContain('--disable-dev-shm-usage');
});

const browserAvailable = Boolean(await findBrowser());
describe.skipIf(!browserAvailable)('screenshot page errors and WebGL', () => {
  it('relays the render page error message without browser noise', async () => {
    const screenshots = new ScreenshotService(await renderServer());
    cleanup.push(() => screenshots.close());
    const failure = await screenshots.capture('broken', { views: ['top'], tileSize: 64 }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toBe('Render page error: WebGL is not available in this browser: test mode');
  });

  it('creates a WebGL context in the headless render page', async () => {
    const screenshots = new ScreenshotService(await renderServer());
    cleanup.push(() => screenshots.close());
    const png = await screenshots.capture('webgl', { views: ['top'], tileSize: 64 });
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
