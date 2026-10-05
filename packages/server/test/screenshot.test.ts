import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mockScene } from '../src/mock.js';
import {
  SCREENSHOT_BROWSER_ARGS,
  SCREENSHOT_TIMEOUT_MS,
  ScreenshotService,
  findBrowser,
} from '../src/screenshot.js';
import { DEFAULT_REQUEST_TIMEOUT_MSEC } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { createServer as createMapeditServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/**
 * Serves the test render page and a scene, like the editor server does for /render.
 * `held` counts the page's never-answered /hold requests that the browser has closed.
 */
async function renderServer(): Promise<{ url: string; held: { closed: number } }> {
  const html = await readFile(new URL('./fixtures/render/index.html', import.meta.url));
  const held = { closed: 0 };
  const server = createServer((request, response) => {
    if (request.url === '/hold') {
      request.socket.once('close', () => held.closed++);
      return;
    }
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
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${address.port}`, held };
}

it('lets the headless browser fall back to software WebGL on machines without a GPU', () => {
  expect(SCREENSHOT_BROWSER_ARGS).toContain('--enable-unsafe-swiftshader');
  expect(SCREENSHOT_BROWSER_ARGS).toContain('--disable-dev-shm-usage');
});

const browserAvailable = Boolean(await findBrowser());
describe.skipIf(!browserAvailable)('screenshot page errors and WebGL', () => {
  it('relays the render page error message without browser noise', async () => {
    const screenshots = new ScreenshotService((await renderServer()).url);
    cleanup.push(() => screenshots.close());
    const failure = await screenshots.capture('broken', { views: ['top'], tileSize: 64 }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toBe('Render page error: WebGL is not available in this browser: test mode');
  });

  it('creates a WebGL context in the headless render page', async () => {
    const screenshots = new ScreenshotService((await renderServer()).url);
    cleanup.push(() => screenshots.close());
    const png = await screenshots.capture('webgl', { views: ['top'], tileSize: 64 });
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const timeoutMessage = (seconds: number) =>
  `The render page did not finish within ${seconds} seconds and was closed. Try again, or ask for fewer views or a smaller tileSize.`;
describe.skipIf(!browserAvailable)('F31 screenshots never wait forever', () => {
  it('closes a render page that never finishes and keeps the browser usable', async () => {
    const server = await renderServer();
    // F41: the limit covers the whole capture, so the browser starts before it is measured.
    const screenshots = new ScreenshotService(server.url, undefined, { timeoutMs: 3000 });
    cleanup.push(() => screenshots.close());
    await screenshots.capture('warm', { views: ['top'], tileSize: 64 });
    const started = Date.now();
    const failure = await screenshots
      .capture('hang', { views: ['top'], tileSize: 64 })
      .then(() => undefined, message);
    expect(failure).toBe(timeoutMessage(3));
    expect(Date.now() - started).toBeLessThan(6_000);
    // The page's open request ends only when the page is gone.
    await expect.poll(() => server.held.closed).toBe(1);
    const png = await screenshots.capture('after', { views: ['top'], tileSize: 64 });
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('caps a long render page error', async () => {
    const screenshots = new ScreenshotService((await renderServer()).url);
    cleanup.push(() => screenshots.close());
    const failure = await screenshots
      .capture('verbose', { views: ['top'], tileSize: 64 })
      .then(() => undefined, message);
    expect(failure).toMatch(/^Render page error: Shader log: x+… \(\d+ more characters\)$/);
    expect(failure!.length).toBeLessThan(1_100);
  });

  it('answers the MCP screenshot call with the timeout error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mapedit-render-timeout-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'maps/hang'), { recursive: true });
    await writeFile(join(root, 'project.yaml'), 'name: Hanging render\n');
    await writeFile(join(root, 'maps/hang/map.yaml'), 'size: {x: 100, z: 100}\n');
    const server = await createMapeditServer({
      root,
      port: 0,
      webRoot: fileURLToPath(new URL('./fixtures/render', import.meta.url)),
      screenshotTimeoutMs: 8000,
    });
    cleanup.push(() => server.close());
    const client = new Client({ name: 'render-timeout-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    const result = (await client.callTool({
      name: 'screenshot',
      arguments: { map: 'hang', views: ['top'], tileSize: 64 },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe(timeoutMessage(8));
  });
});

it('exports the browser lookup and launch flags for the frontend browser tests', async () => {
  const server = await import('../src/index.js');
  expect(server.findBrowser).toBe(findBrowser);
  expect(server.SCREENSHOT_BROWSER_ARGS).toBe(SCREENSHOT_BROWSER_ARGS);
});

describe('F41 one time limit for the whole screenshot', () => {
  it('stays below the default request timeout of MCP clients', () => {
    expect(SCREENSHOT_TIMEOUT_MS).toBe(50_000);
    expect(SCREENSHOT_TIMEOUT_MS).toBeLessThan(DEFAULT_REQUEST_TIMEOUT_MSEC);
  });

  it.skipIf(!browserAvailable)(
    'fails a page that never becomes ready within the limit',
    async () => {
      const screenshots = new ScreenshotService((await renderServer()).url, undefined, {
        timeoutMs: 3000,
      });
      cleanup.push(() => screenshots.close());
      await screenshots.capture('warm', { views: ['top'], tileSize: 64 });
      const started = Date.now();
      const failure = await screenshots
        .capture('never-ready', { views: ['top'], tileSize: 64 })
        .then(() => undefined, message);
      expect(failure).toBe(
        'The render page did not become ready within 3 seconds and was closed. Check that the editor build loads, then try again.',
      );
      expect(Date.now() - started).toBeLessThan(6_000);
    },
  );

  it('caps every error message, including browser launch errors', async () => {
    const executable = join(tmpdir(), 'mapedit-missing-browser', 'x'.repeat(1500));
    const screenshots = new ScreenshotService('http://127.0.0.1:9', executable);
    cleanup.push(() => screenshots.close());
    const failure = await screenshots
      .capture('any', { views: ['top'], tileSize: 64 })
      .then(() => undefined, message);
    expect(failure).toMatch(/… \(\d+ more characters\)$/);
    expect(failure!.length).toBeLessThan(1_100);
    expect(failure).not.toContain('\n');
  });
});
