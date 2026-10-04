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
  screenPoint,
} from './browser/harness.js';

const executable = await findBrowser();
const template = fileURLToPath(new URL('../../../templates/project/', import.meta.url));

/**
 * A project with two maps that both contain `structure:house` and
 * `marker:player_spawn`, so an edit sent to the wrong map would land.
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
    await page.waitForTimeout(300);
    const edits = sent.slice(switchedAt).filter((m) => /Edit$/.test(m.type));
    expect(edits).toEqual([]);
    expect(await editorState(page, (e) => e.store.state.selection)).toBeUndefined();

    release();
    await poll(() => editorState(page, (e) => e.store.state.scene?.map.id)).toBe('second');
    expect(await readFile(join(root, 'maps/second/structures/house.yaml'), 'utf8')).toBe(before);
  });
});
