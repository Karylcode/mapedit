import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright-core';
import { createServer, type MapeditServer } from '@mapedit/server';
import {
  buildWeb,
  editorState,
  findBrowser,
  launch,
  lookDown,
  openEditor,
  poll,
  pressPoint,
  screenPoint,
  pageErrors,
} from './browser/harness.js';

const executable = await findBrowser();
const template = fileURLToPath(new URL('../../../templates/project/', import.meta.url));

/**
 * A project with two maps that both contain `structure:house` and
 * `marker:player_spawn`, so an edit sent to the wrong map would land, plus an
 * empty third map that no test opens.
 */
async function twoMapProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-two-maps-'));
  await cp(template, root, { recursive: true });
  const second = join(root, 'maps/second');
  await mkdir(join(second, 'structures'), { recursive: true });
  await writeFile(
    join(second, 'map.yaml'),
    'id: second\nname: Second Map\nsize: { x: 100, z: 100 }\nsun: { azimuth: 135, elevation: 45 }\n',
  );
  await cp(join(root, 'maps/village/structures/house.yaml'), join(second, 'structures/house.yaml'));
  await cp(join(root, 'maps/village/markers.yaml'), join(second, 'markers.yaml'));
  await mkdir(join(root, 'maps/third'));
  await writeFile(
    join(root, 'maps/third/map.yaml'),
    'id: third\nname: Third Map\nsize: { x: 100, z: 100 }\nsun: { azimuth: 135, elevation: 45 }\n',
  );
  return root;
}

describe.skipIf(!executable)('switching maps in a real two-map project', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let root: string;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;
  /** Client → server messages, and server snapshots held back while `holding` is set. */
  const sent: { type: string }[] = [];
  const held: string[] = [];
  let holding = false;
  let release: () => void = () => {};

  beforeAll(async () => {
    web = await buildWeb();
    root = await twoMapProject();
    server = await createServer({ root, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, `${server.url}/?map=village`, 'en-US', async (target) => {
      await target.routeWebSocket(/\/ws$/, (client) => {
        const upstream = client.connectToServer();
        client.onMessage((message) => {
          sent.push(JSON.parse(String(message)));
          upstream.send(message);
        });
        upstream.onMessage((message) => {
          const text = String(message);
          if (holding && /"type":"(scene|history)"/.test(text)) held.push(text);
          else client.send(message);
        });
        release = () => {
          holding = false;
          for (const message of held.splice(0)) client.send(message);
        };
      });
    });
    await lookDown(page);
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('sends no edits to the new map until its first snapshot arrives (FE3)', async () => {
    const house = await screenPoint(page, 'module:house/roof');
    await page.mouse.click(house.x, house.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
    const before = await readFile(join(root, 'maps/second/structures/house.yaml'), 'utf8');

    holding = true;
    await page.locator('.tb-select').selectOption('second');
    await poll(() => editorState(page, (e) => e.connection.currentMap)).toBe('second');
    const switchedAt = sent.length;
    // The old map is still drawn: try to delete, rotate and drag what is on screen.
    expect(await editorState(page, (e) => e.store.state.selection)).toBeUndefined();
    await page.mouse.click(house.x, house.y);
    await page.keyboard.press('Delete');
    await page.keyboard.press('r');
    await page.mouse.move(house.x, house.y);
    await page.mouse.down();
    await page.mouse.move(house.x + 60, house.y + 40, { steps: 6 });
    await page.mouse.up();
    // Nothing may be sent: give a wrongly sent edit time to show up, then check.
    await page.waitForTimeout(300);
    const edits = sent.slice(switchedAt).filter((m) => /Edit$/.test(m.type));
    expect(edits).toEqual([]);
    expect(await editorState(page, (e) => e.store.state.selection)).toBeUndefined();

    release();
    await poll(() => editorState(page, (e) => e.store.state.scene?.map.id)).toBe('second');
    expect(await readFile(join(root, 'maps/second/structures/house.yaml'), 'utf8')).toBe(before);
  });

  it('goes back to the open map when the chosen one was just deleted (FE13)', async () => {
    if ((await editorState(page, (e) => e.connection.currentMap)) !== 'second')
      await page.locator('.tb-select').selectOption('second');
    await poll(() => editorState(page, (e) => e.store.state.scene?.map.id)).toBe('second');
    await lookDown(page);
    // The Agent deletes a map that was never opened; the page still lists it.
    await rm(join(root, 'maps/third'), { recursive: true, force: true });
    await page.locator('.tb-select').selectOption('third');

    const toast = page.locator('.toast', { hasText: 'no longer in the project' });
    await poll(() => toast.count()).toBe(1);
    expect(await toast.locator('.toast-detail').textContent()).toContain('third');
    await poll(() =>
      editorState(page, (e) => ({
        mapId: e.store.state.mapId,
        scene: e.store.state.scene?.map.id,
        loading: e.store.state.loadingMap,
        connection: e.connection.currentMap,
      })),
    ).toEqual({ mapId: 'second', scene: 'second', loading: false, connection: 'second' });
    expect(await page.locator('.tb-select').inputValue()).toBe('second');
    expect(new URL(page.url()).searchParams.get('map')).toBe('second');
    // The map still open can be picked as before, from under the error toast.
    const house = await pressPoint(page, 'module:house/roof');
    await page.mouse.click(house.x, house.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
  });

  it('gives the keyboard back to the map once a map is chosen (FE14)', async () => {
    const select = page.locator('.tb-select');
    const other = (await select.inputValue()) === 'second' ? 'village' : 'second';
    // Like picking from the list with the mouse: the list has focus when it changes.
    await select.focus();
    await select.selectOption(other);
    await poll(() => editorState(page, (e) => e.store.state.scene?.map.id)).toBe(other);
    const target = () => editorState(page, (e) => e.viewport.overview.target.toArray());
    for (const key of ['KeyW', 'ArrowDown']) {
      const before: number[] = await target();
      await page.keyboard.down(key);
      await poll(target, { timeout: 3000 }).not.toEqual(before);
      await page.keyboard.up(key);
      expect(await editorState(page, (e) => e.store.state.mapId)).toBe(other);
      expect(await select.inputValue()).toBe(other);
    }
  });

  it('names and outlines what the Agent changed on the open map only (FE17)', async () => {
    const select = page.locator('.tb-select');
    if ((await select.inputValue()) !== 'village') await select.selectOption('village');
    await poll(() => editorState(page, (e) => e.store.state.scene?.map.id)).toBe('village');
    const flashed = () => editorState(page, (e) => e.map.outlines.flash.refs);
    const edit = async (file: string, from: RegExp | string, to: string) =>
      writeFile(join(root, file), (await readFile(join(root, file), 'utf8')).replace(from, to));

    // The other map has a structure:house too; this one must not light up.
    await edit('maps/second/structures/house.yaml', /position: \[[^\]]+\]/, 'position: [70, 70]');
    const elsewhere = page.locator('.toast-text', { hasText: 'on Second Map' });
    await poll(() => elsewhere.count()).toBe(1);
    expect(await elsewhere.textContent()).toBe('The Agent changed house on Second Map');
    expect(await flashed()).toEqual([]);

    // On the open map, the toast already uses the new name: the scene comes first.
    await edit(
      'maps/village/structures/house.yaml',
      'name: Starter House',
      'name: Renamed Cottage',
    );
    const here = page.locator('.toast-text', { hasText: 'The Agent changed Renamed Cottage' });
    await poll(() => here.count()).toBe(1);
    await poll(flashed).toEqual(['structure:house']);
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
