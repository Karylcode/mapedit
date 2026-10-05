import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { createServer, type MapeditServer } from '@mapedit/server';
import {
  buildWeb,
  editorState,
  findBrowser,
  launch,
  openEditor,
  projectPoint,
  screenPoint,
  type EditorHandle,
  pageErrors,
  poll,
} from './browser/harness.js';

const executable = await findBrowser();

describe.skipIf(!executable)('editor in a real browser (mock server)', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    server = await createServer({ mock: true, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
  });

  it('shows the project, map and live link in the title block', async () => {
    const text = await page.locator('.title-block').innerText();
    expect(text).toMatch(/Mock project/);
    expect(text).toMatch(/Mock village/);
    expect(await page.locator('.tb-link').getAttribute('data-status')).toBe('open');
    expect(page.url()).toMatch(/\?map=village$/);
  });

  it('draws every kind of mock data', async () => {
    const drawn = await editorState(page, (e) => {
      const types: Record<string, number> = {};
      for (const mesh of e.map.root.getObjectByName('modules').children)
        types[mesh.name] = mesh.count;
      return {
        types,
        terrain: e.map.root.getObjectByName('terrain').children.length,
        generated: e.map.root.getObjectByName('generated').children.length,
        markers: e.map.root.getObjectByName('markers').children.length,
        flags: e.map.violationMarks.flags.children.length,
        progress: e.store.state.progress,
        violationBoxes: e.map.violationMarks.glass.count,
      };
    });
    expect(drawn.types).toEqual({ block: 9, foundation: 1, missing_block: 1 });
    expect(drawn.terrain).toBe(1);
    expect(drawn.generated).toBe(1);
    expect(drawn.flags).toBe(7);
    expect(drawn.markers).toBe(2);
    expect(drawn.progress).toEqual({ loaded: 4, total: 4 });
    expect(drawn.violationBoxes).toBeGreaterThan(0);
  });

  it('names what is under the pointer and selects structure, then module; Esc clears', async () => {
    const house = await screenPoint(page, 'module:house/base');
    await page.mouse.move(house.x, house.y);
    await poll(() => page.locator('.tooltip').isVisible()).toBe(true);
    expect(await page.locator('.tooltip').innerText()).toMatch(/House/);
    await page.mouse.click(house.x, house.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
    expect(await page.locator('.action-name').innerText()).toBe('House');
    await page.mouse.click(house.x, house.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('module:house/base');
    await page.keyboard.press('Escape');
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBeUndefined();
  });

  it('selects markers and clears the selection on empty ground', async () => {
    // The spawn point sits in the map's corner, under the side panels from the default view.
    await page.evaluate(() => {
      const editor = (globalThis as unknown as { mapeditEditor: EditorHandle }).mapeditEditor;
      editor.viewport.overview.target.set(8, 0, 8);
      editor.viewport.overview.distance = 30;
      editor.viewport.invalidate();
    });
    const zone = await screenPoint(page, 'marker:spawn');
    await page.mouse.click(zone.x, zone.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('marker:spawn');
    expect(await page.locator('.action-kind').innerText()).toMatch(/spawn point/i);
    const empty = await projectPoint(page, [14, 0, 2]);
    await page.mouse.click(empty.x, empty.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBeUndefined();
  });

  it('focuses the selection with F', async () => {
    await page.evaluate(() => {
      const editor = (globalThis as unknown as { mapeditEditor: EditorHandle }).mapeditEditor;
      editor.viewport.overview.target.set(30, 0, 30);
      editor.viewport.overview.distance = 60;
      editor.viewport.invalidate();
    });
    const before = await editorState(page, (e) => e.viewport.overview.distance);
    const target = await screenPoint(page, 'module:raised_foundation/base');
    await page.mouse.click(target.x, target.y);
    await page.keyboard.press('f');
    // The flight ends over the foundation.
    await poll(() => editorState(page, (e) => e.viewport.overview.target.x), {
      timeout: 3000,
    }).toBeCloseTo(21, 0);
    const after = await editorState(page, (e) => ({
      target: e.viewport.overview.target.toArray(),
      distance: e.viewport.overview.distance,
    }));
    expect(after.distance).toBeLessThan(before);
    expect(after.target[0]).toBeCloseTo(21, 0);
    expect(after.target[2]).toBeCloseTo(21, 0);
    await page.keyboard.press('Escape');
  });

  it('orbits with the right button, pans with the middle button and WASD, zooms with the wheel', async () => {
    const camera = () =>
      editorState(page, (e) => ({
        bearing: e.viewport.overview.bearing,
        pitch: e.viewport.overview.pitch,
        target: e.viewport.overview.target.toArray(),
        distance: e.viewport.overview.distance,
      }));
    const start = await camera();
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(700, 380, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const orbited = await camera();
    expect(orbited.bearing).not.toBeCloseTo(start.bearing, 1);

    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(560, 460, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    const panned = await camera();
    expect(panned.target).not.toEqual(orbited.target);
    expect(panned.distance).toBeCloseTo(orbited.distance);

    await page.mouse.wheel(0, -400);
    await poll(async () => (await camera()).distance).toBeLessThan(panned.distance);

    const beforeKeys = (await camera()).target;
    await page.keyboard.down('KeyW');
    await poll(async () => (await camera()).target).not.toEqual(beforeKeys);
    await page.keyboard.up('KeyW');
    expect(await camera()).toMatchObject({ bearing: orbited.bearing });
  });

  it('pans with the arrow keys the same way as WASD (FE21)', async () => {
    // From the middle of the map, so no edge stops the camera.
    await editorState(page, (e) => {
      e.viewport.overview.target.set(50, 0, 50);
      e.viewport.invalidate();
    });
    const target = () => editorState(page, (e) => e.viewport.overview.target.toArray() as number[]);
    /** Hold a key until the camera has moved half a meter, and say which way it went. */
    const hold = async (key: string) => {
      const before = await target();
      const moved = async () => {
        const now = await target();
        return Math.hypot(now[0]! - before[0]!, now[2]! - before[2]!);
      };
      await page.keyboard.down(key);
      await poll(moved).toBeGreaterThan(0.5);
      await page.keyboard.up(key);
      const after = await target();
      return [after[0]! - before[0]!, after[2]! - before[2]!] as const;
    };
    for (const [arrow, letter] of [
      ['ArrowUp', 'KeyW'],
      ['ArrowDown', 'KeyS'],
      ['ArrowLeft', 'KeyA'],
      ['ArrowRight', 'KeyD'],
    ] as const) {
      const [ax, az] = await hold(arrow);
      const [lx, lz] = await hold(letter);
      expect(ax * lx + az * lz, `${arrow} moves like ${letter}`).toBeGreaterThan(0);
    }
  });

  it('stops reconnecting when the server cannot read hello (FE15)', async () => {
    const other = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
    });
    let connections = 0;
    // A server that speaks another protocol version closes on hello, as the real one does.
    await other.routeWebSocket(/\/ws$/, (socket) => {
      connections++;
      socket.onMessage(() => socket.close({ code: 1008, reason: 'Invalid protocol message.' }));
    });
    await other.goto(server.url);
    await poll(() => other.locator('.tb-link').getAttribute('data-status')).toBe('incompatible');
    expect(await other.locator('.status-message').textContent()).toBe(
      'Incompatible server version',
    );
    // Retries would start within 250 ms and repeat within a second.
    await other.waitForTimeout(1500);
    expect(connections).toBe(1);
    await other.close();
  });

  it('keeps the panels and toasts apart in narrow windows (FE16)', async () => {
    const narrow = await openEditor(browser, server.url);
    // A busy moment: violations listed, a long change log open and three toasts.
    await editorState(narrow, (e) => {
      const time = new Date().toISOString();
      const entries = Array.from({ length: 14 }, (_, i) => ({
        id: i + 1,
        author: i % 2 ? 'agent' : 'human',
        time,
        summary: 'Move structure:house',
        files: ['maps/village/structures/house.yaml'],
      }));
      e.store.set({ history: { entries, cursor: entries.length } });
      e.toasts.show({ level: 'info', text: 'The Agent changed House', key: 'a', seconds: 60 });
      e.toasts.show({
        level: 'warning',
        text: "The Agent's later change replaced your edit to House",
        detail: 'Agent changes overwrite recent human edits.',
        key: 'b',
        seconds: 60,
      });
      e.toasts.show({
        level: 'error',
        text: 'A file could not be read',
        detail: 'maps/village/structures/broken.yaml:2: close the opening bracket on line 2.',
        key: 'c',
        seconds: 60,
      });
    });
    if ((await narrow.locator('.history').getAttribute('data-open')) !== 'true')
      await narrow.locator('.history .panel-toggle').click();

    for (const size of [
      { width: 960, height: 720 },
      { width: 700, height: 600 },
    ]) {
      await narrow.setViewportSize(size);
      const boxes = await narrow.evaluate(() =>
        ['.title-block', '.issues', '.history', '.action-bar', '.toast'].flatMap((selector) =>
          [...document.querySelectorAll(selector)].map((element, i) => {
            const { left, top, right, bottom } = element.getBoundingClientRect();
            return { name: `${selector} ${i}`, left, top, right, bottom };
          }),
        ),
      );
      expect(boxes.map((box) => box.name.split(' ')[0])).toEqual([
        '.title-block',
        '.issues',
        '.history',
        '.action-bar',
        '.toast',
        '.toast',
        '.toast',
      ]);
      for (const [i, a] of boxes.entries()) {
        const where = `${size.width}x${size.height}: ${a.name}`;
        expect(a.bottom - a.top, `${where} has height`).toBeGreaterThan(20);
        expect(
          a.left >= 0 && a.top >= 0 && a.right <= size.width && a.bottom <= size.height,
          `${where} is inside the window`,
        ).toBe(true);
        for (const b of boxes.slice(i + 1))
          expect(
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
            `${where} overlaps ${b.name}`,
          ).toBe(false);
      }
    }
    expect(pageErrors(narrow)).toEqual([]);
    await narrow.close();
  });

  it('keeps a warning when info toasts overflow (FE19)', async () => {
    const fresh = await openEditor(browser, server.url);
    const texts = await editorState(fresh, (e) => {
      e.toasts.show({ level: 'warning', text: 'Your edit was replaced', key: 'w', seconds: 60 });
      for (let i = 1; i <= 4; i++)
        e.toasts.show({ level: 'info', text: `Info ${i}`, key: `i${i}`, seconds: 60 });
      return e.toasts.texts();
    });
    expect(texts).toEqual(['Info 4', 'Info 3', 'Info 2', 'Your edit was replaced']);
    expect(pageErrors(fresh)).toEqual([]);
    await fresh.close();
  });

  it('follows the screen pixel density after it changes (FE20)', async () => {
    const fresh = await openEditor(browser, server.url);
    const pixels = () =>
      editorState(fresh, (e) => ({
        ratio: e.viewport.renderer.getPixelRatio(),
        width: e.viewport.renderer.domElement.width,
      }));
    expect(await pixels()).toEqual({ ratio: 1, width: 1280 });
    // Like moving the window to a 200% screen: same CSS size, twice the pixels.
    const cdp = await fresh.context().newCDPSession(fresh);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      mobile: false,
    });
    // Nothing is resized; the next frame, here from moving the pointer, picks it up.
    await fresh.mouse.move(640, 400);
    await fresh.mouse.move(660, 410);
    await poll(pixels).toEqual({ ratio: 2, width: 2560 });
    expect(pageErrors(fresh)).toEqual([]);
    await fresh.close();
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
