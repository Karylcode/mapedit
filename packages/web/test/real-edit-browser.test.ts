import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { createServer, type MapeditServer } from '@mapedit/server';
import {
  buildWeb,
  dragTo,
  editorState,
  findBrowser,
  launch,
  lookDown,
  openEditor,
  projectPoint,
  screenPoint,
  poll,
  pageErrors,
} from './browser/harness.js';

const executable = await findBrowser();
const template = fileURLToPath(new URL('../../../templates/project/', import.meta.url));

describe.skipIf(!executable)('editing a real project in a real browser', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let root: string;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;
  const house = () => readFile(join(root, 'maps/village/structures/house.yaml'), 'utf8');
  const markers = () => readFile(join(root, 'maps/village/markers.yaml'), 'utf8');
  const revision = () => editorState(page, (e) => e.store.state.revision as number);

  beforeAll(async () => {
    web = await buildWeb();
    root = await mkdtemp(join(tmpdir(), 'mapedit-real-web-'));
    await cp(template, root, { recursive: true });
    server = await createServer({ root, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url);
    await lookDown(page);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('draws the template village with its textured modules', async () => {
    const drawn = await editorState(page, (e) => ({
      modules: e.map.root
        .getObjectByName('modules')
        .children.reduce((n: number, mesh: { count: number }) => n + mesh.count, 0),
      violations: e.store.state.scene.violations.length,
      textured: e.map.root
        .getObjectByName('modules')
        .children.some((mesh: { material: { map?: unknown } }) => Boolean(mesh.material.map)),
    }));
    expect(drawn.violations).toBe(0);
    expect(drawn.textured).toBe(true);
    expect(drawn.modules).toBeGreaterThanOrEqual(8);
  });

  it('writes a dragged structure back to YAML and keeps the comment', async () => {
    const start = await revision();
    const from = await screenPoint(page, 'module:house/roof');
    const to = await projectPoint(page, [22 + 8, 4, 22]);
    await dragTo(page, from, to);
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    const text = await house();
    expect(text).toMatch(/^# A walkable room: the door and window are genuine cutouts/);
    expect(text).toMatch(/position: \[(27\.5|28|28\.5), (19\.5|20|20\.5)\]/);
    const history = await editorState(page, (e) => e.store.state.history.entries.at(-1));
    expect(history).toMatchObject({ author: 'human', summary: 'Move structure:house' });
  });

  it('leaves the files alone when a drop is rejected (FE21)', async () => {
    await page.keyboard.press('Escape');
    const before = await house();
    const start = await revision();
    const from = await screenPoint(page, 'module:house/roof');
    // Off the west edge of the map: out of bounds, so the backend refuses it.
    const to = await projectPoint(page, [-10, 4, 30]);
    await dragTo(page, from, to);
    await poll(() => page.locator('.toast-text').allInnerTexts()).toContain(
      'Starter House was not moved',
    );
    expect(await house()).toBe(before);
    expect(await revision()).toBe(start);
    expect(
      await editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')),
    ).toBeUndefined();
  });

  it('rotates with R and deletes a single module, then undoes and redoes', async () => {
    await page.keyboard.press('Escape');
    const roof = await screenPoint(page, 'module:house/roof');
    await page.mouse.click(roof.x, roof.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
    let start = await revision();
    await page.keyboard.press('r');
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    expect(await house()).toMatch(/rotation: 15/);

    const stairs = await screenPoint(page, 'module:house/stairs');
    await page.mouse.click(stairs.x, stairs.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('module:house/stairs');
    start = await revision();
    await page.keyboard.press('Delete');
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    expect(await house()).not.toMatch(/id: stairs/);
    expect(await house()).toMatch(/^# A walkable room/);
    start = await revision();
    await page.keyboard.press('Control+z');
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    expect(await house()).toMatch(/id: stairs/);
    start = await revision();
    await page.keyboard.press('Control+y');
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    expect(await house()).not.toMatch(/id: stairs/);
    expect(await house()).toMatch(/^# A walkable room/);
  });

  it('moves a marker and keeps its properties', async () => {
    await page.keyboard.press('Escape');
    const start = await revision();
    const spawn = await screenPoint(page, 'marker:player_spawn');
    const to = await projectPoint(page, [40, 0, 40]);
    await dragTo(page, spawn, to);
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    const text = await markers();
    expect(text).toMatch(/properties: \{ team: player \}/);
    expect(text).not.toMatch(/position: \[22, 0, 28\]/);
  });

  it('follows the Agent editing YAML by hand', async () => {
    const start = await revision();
    const text = await house();
    await writeFile(
      join(root, 'maps/village/structures/house.yaml'),
      text.replace(/position: \[[^\]]+\]/, 'position: [60, 60]'),
    );
    await poll(revision, { timeout: 15_000 }).toBeGreaterThan(start);
    const origin = await editorState(page, (e) => {
      const transform = e.store.state.scene.structures.find(
        (s: { ref: string }) => s.ref === 'structure:house',
      ).transform;
      return [transform[12], transform[14]];
    });
    expect(origin).toEqual([60, 60]);
    const last = await editorState(page, (e) => e.store.state.history.entries.at(-1));
    expect(last.author).toBe('agent');
  });

  it('widens the camera limits when the Agent enlarges the map (FE11)', async () => {
    const limits = () =>
      editorState(page, (e) => ({
        maxDistance: e.viewport.overview.maxDistance,
        margin: e.viewport.overview.margin,
      }));
    expect(await limits()).toEqual({ maxDistance: 160, margin: 10 });
    const file = join(root, 'maps/village/map.yaml');
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replace('{ x: 100, z: 100 }', '{ x: 400, z: 400 }'),
    );
    await poll(() => editorState(page, (e) => e.store.state.scene.map.size.x)).toBe(400);
    expect(await limits()).toEqual({ maxDistance: 640, margin: 40 });
    // F with nothing selected now frames the larger map.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('f');
    await poll(() => editorState(page, (e) => e.viewport.overview.target.x), {
      timeout: 5000,
    }).toBe(200);
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
