import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer, type MapeditServer } from '@mapedit/server';
import type { RenderSpec, RenderWindow } from '@mapedit/protocol';
import { buildWeb, findBrowser, launch, pageErrors, watchErrors } from './browser/harness.js';

const executable = await findBrowser();
const template = fileURLToPath(new URL('../../../templates/project/', import.meta.url));

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const fromDataUrl = (url: string) =>
  Buffer.from(url.slice('data:image/png;base64,'.length), 'base64');

const externalRequests = new WeakMap<Page, string[]>();

/**
 * Open the render page the way the backend does: same-origin requests only.
 * Requests to anywhere else are blocked and recorded for `externalRequests`.
 */
async function openRender(browser: Browser, server: MapeditServer, map: string): Promise<Page> {
  const page = await browser.newPage();
  watchErrors(page);
  const origin = new URL(server.url).origin;
  const external: string[] = [];
  externalRequests.set(page, external);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:')
      return route.continue();
    external.push(url.href);
    return route.abort();
  });
  await page.goto(`${server.url}/render?map=${encodeURIComponent(map)}`);
  await page.waitForFunction(
    () => (window as unknown as RenderWindow).mapeditRenderReady === true,
    undefined,
    {
      timeout: 30_000,
    },
  );
  return page;
}

const render = (page: Page, spec: RenderSpec) =>
  page.evaluate((value) => (window as unknown as RenderWindow).mapeditRender(value), spec);

/**
 * Pixels close to flag red (violations) and chalk-line blue (highlights), and
 * the number of distinct colors in steps of 16: a blank image has one. With
 * `region` ([x, y, width, height]), only that part of the image counts.
 */
const imageStats = (page: Page, dataUrl: string, region?: [number, number, number, number]) =>
  page.evaluate(
    async ({ url, region }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(image, 0, 0);
      const [x, y, width, height] = region ?? [0, 0, image.width, image.height];
      const data = g.getImageData(x, y, width, height).data;
      const near = (i: number, r: number, gr: number, b: number) =>
        Math.abs(data[i]! - r) + Math.abs(data[i + 1]! - gr) + Math.abs(data[i + 2]! - b) < 90;
      const colors = new Set<number>();
      let flag = 0;
      let chalkline = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (near(i, 224, 65, 47)) flag++;
        if (near(i, 43, 95, 217)) chalkline++;
        colors.add(((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4));
      }
      return { flag, chalkline, colors: colors.size };
    },
    { url: dataUrl, region },
  );

/** RGBA at a pixel of a rendered montage, read back inside the page. */
const pixel = (page: Page, dataUrl: string, x: number, y: number) =>
  page.evaluate(
    async ({ url, x, y }) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext('2d')!;
      g.drawImage(image, 0, 0);
      return [...g.getImageData(x, y, 1, 1).data];
    },
    { url: dataUrl, x, y },
  );

describe.skipIf(!executable)('the /render page', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    server = await createServer({ mock: true, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openRender(browser, server, 'village');
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
  });

  it('shows no interface elements', async () => {
    expect(await page.evaluate(() => document.body.querySelectorAll(':not(script)').length)).toBe(
      0,
    );
  });

  it('draws one tile per view, three to a row, labeled, with north up in the top view', async () => {
    const tile = 128;
    const all = await render(page, { views: ['top', 'ne', 'nw', 'se', 'sw'], tileSize: tile });
    expect(pngSize(fromDataUrl(all))).toEqual([3 * tile, 2 * tile]);
    expect(pngSize(fromDataUrl(await render(page, { views: ['ne'], tileSize: tile })))).toEqual([
      tile,
      tile,
    ]);
    expect(
      pngSize(fromDataUrl(await render(page, { views: ['top', 'sw'], tileSize: tile }))),
    ).toEqual([2 * tile, tile]);
    // The label tag in the top-left corner is dark ink.
    const label = await pixel(page, all, 8, 8);
    expect(label.slice(0, 3).every((value) => value < 60)).toBe(true);
    // The top view's north arrow is red.
    const arrow = await pixel(page, all, tile - Math.round(12 * 1.6), Math.round(12 * 1.6) - 6);
    expect(arrow[0]).toBeGreaterThan(180);
    expect(arrow[1]).toBeLessThan(120);
    // The middle of the top view is the green mock terrain, seen from straight above.
    const ground = await pixel(page, all, tile / 2, tile / 2 + 20);
    expect(ground[1]).toBeGreaterThan(ground[2]!);
  });

  it('marks violations and highlights only when asked', async () => {
    const spec: RenderSpec = {
      views: ['top'],
      tileSize: 256,
      focus: { center: [41, 1, 11], radius: 4 },
    };
    const plain = await render(page, { ...spec, showViolations: false });
    const marked = await render(page, { ...spec, showViolations: true });
    const highlighted = await render(page, {
      ...spec,
      showViolations: false,
      highlight: ['structure:overlap_a'],
    });
    const stats = {
      plain: await imageStats(page, plain),
      marked: await imageStats(page, marked),
      highlighted: await imageStats(page, highlighted),
    };
    // Violations add flag-red outlines, glass and flags; the top view's north arrow is red too.
    expect(stats.marked.flag).toBeGreaterThan(stats.plain.flag + 1000);
    // A highlight is a chalk-line blue outline and shows no violations.
    expect(stats.plain.chalkline).toBe(0);
    expect(stats.highlighted.chalkline).toBeGreaterThan(200);
    expect(stats.highlighted.flag).toBeLessThan(stats.plain.flag + 30);
  });

  it('waits for minRevision before drawing', async () => {
    const revision = (await (await fetch(`${server.url}/api/scene`)).json()).revision as number;
    const pending = render(page, { views: ['top'], tileSize: 64, minRevision: revision + 1 });
    let done = false;
    void pending.then(() => (done = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(done).toBe(false);
    const response = await fetch(`${server.url}/api/mock/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notice: 'agent_changed' }),
    });
    expect(response.status).toBe(200);
    expect(pngSize(fromDataUrl(await pending))).toEqual([64, 64]);
  });

  it('explains bad requests and unknown maps instead of hanging', async () => {
    await expect(render(page, { views: [], tileSize: 64 })).rejects.toThrow(/views/);
    await expect(render(page, { views: ['top'], tileSize: 3 })).rejects.toThrow(/tileSize/);
    const missing = await openRender(browser, server, 'nowhere');
    await expect(render(missing, { views: ['top'], tileSize: 64 })).rejects.toThrow(
      /Could not load map "nowhere"/,
    );
    await missing.close();
  });

  it('asks nothing of other sites and reports no page or console errors', () => {
    expect(externalRequests.get(page)).toEqual([]);
    expect(pageErrors(page)).toEqual([]);
  });
});

describe.skipIf(!executable)('MCP screenshots from a real project', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let root: string;
  let server: MapeditServer;
  let client: Client;
  let browser: Browser;
  /** A blank page that decodes the returned images. */
  let decoder: Page;

  beforeAll(async () => {
    web = await buildWeb();
    browser = await launch(executable!);
    decoder = await browser.newPage();
    root = await mkdtemp(join(tmpdir(), 'mapedit-render-'));
    await cp(template, root, { recursive: true });
    server = await createServer({ root, port: 0, webRoot: web.dir });
    client = new Client({ name: 'render-acceptance', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    await browser?.close();
    await server?.close();
    await web?.dispose();
    if (root) await rm(root, { recursive: true, force: true });
  });

  /**
   * Distinct colors in the middle of the first tile, away from the view label
   * and north arrow that are drawn even when the 3D view is blank.
   */
  const drawnColors = async (png: Buffer, tile: number) => {
    const url = `data:image/png;base64,${png.toString('base64')}`;
    return (await imageStats(decoder, url, [tile / 4, tile / 4, tile / 2, tile / 2])).colors;
  };

  const image = (result: Awaited<ReturnType<Client['callTool']>>) => {
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    const content = result.content as { type: string; data?: string; mimeType?: string }[];
    const found = content.find((item) => item.type === 'image');
    expect(found?.mimeType).toBe('image/png');
    return Buffer.from(found!.data!, 'base64');
  };

  it('returns the five-view montage of the whole map', async () => {
    const png = image(
      await client.callTool({ name: 'screenshot', arguments: { map: 'village', tileSize: 256 } }),
    );
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(pngSize(png)).toEqual([768, 512]);
    expect(await drawnColors(png, 256)).toBeGreaterThan(8);
  }, 60_000);

  it('frames one structure and returns the chosen views', async () => {
    const png = image(
      await client.callTool({
        name: 'screenshot',
        arguments: { map: 'village', structure: 'house', views: ['top', 'ne'], tileSize: 128 },
      }),
    );
    expect(pngSize(png)).toEqual([256, 128]);
    expect(await drawnColors(png, 128)).toBeGreaterThan(8);
  }, 60_000);

  it('previews a single module for build_module', async () => {
    const result = await client.callTool({
      name: 'build_module',
      arguments: { module: 'wall_door' },
    });
    const png = image(result);
    expect(pngSize(png)).toEqual([768, 512]);
    expect(await drawnColors(png, 256)).toBeGreaterThan(8);
  }, 60_000);
});
