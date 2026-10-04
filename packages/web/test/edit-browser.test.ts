import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
} from './browser/harness.js';

const executable = await findBrowser();

/** The map position of a structure's origin and its yaw. */
const placement = (page: Page, ref: string) =>
  editorState(page, (e) => {
    const structures = e.store.state.scene.structures as { ref: string; transform: number[] }[];
    return structures.map((s) => ({
      ref: s.ref,
      x: s.transform[12],
      z: s.transform[14],
      m: s.transform,
    }));
  }).then((all) => {
    const found = all.find((s) => s.ref === ref);
    return (
      found && {
        x: found.x,
        z: found.z,
        yaw: (Math.atan2(-found.m[2]!, found.m[0]!) * 180) / Math.PI,
      }
    );
  });

describe.skipIf(!executable)('editing in a real browser (mock server)', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    server = await createServer({ mock: true, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url);
    await lookDown(page);
    await page.evaluate(() => {
      const editor = (
        globalThis as unknown as {
          mapeditEditor: { connection: { on(e: string, f: (m: { type: string }) => void): void } };
        }
      ).mapeditEditor;
      const log: string[] = [];
      (globalThis as unknown as { messageLog: string[] }).messageLog = log;
      editor.connection.on('message', (message) => log.push(message.type));
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
  });

  const messages = () =>
    page.evaluate(() => (globalThis as unknown as { messageLog: string[] }).messageLog.slice());

  it('drags a structure with a live preview and applies it on drop', async () => {
    const before = (await placement(page, 'structure:house'))!;
    const from = await screenPoint(page, 'module:house/base');
    const to = await projectPoint(page, [before.x + 1 + 10, 0, before.z + 1 + 6]);
    let ghost: { state: string; visible: boolean } | undefined;
    await dragTo(page, from, to, async () => {
      ghost = await editorState(page, (e) => {
        const object = e.viewport.scene.getObjectByName('ghost');
        return object && { state: object.state, visible: object.visible };
      });
    });
    expect(ghost).toEqual({ state: 'ok', visible: true });
    expect((await messages()).filter((type) => type === 'previewResult').length).toBeGreaterThan(0);
    // Snapped by the backend to the 0.5 m grid near the pointer.
    await poll(async () =>
      Math.abs((await placement(page, 'structure:house'))!.x - before.x - 10),
    ).toBeLessThanOrEqual(0.5);
    const after = (await placement(page, 'structure:house'))!;
    expect(Math.abs(after.z - before.z - 6)).toBeLessThanOrEqual(0.5);
    expect(after.x % 0.5).toBe(0);
    expect(
      await editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')),
    ).toBeUndefined();
    const history = await editorState(page, (e) => e.store.state.history);
    expect(history.entries.at(-1)).toMatchObject({
      author: 'human',
      summary: 'Move structure:house',
    });
    expect(await page.locator('.history-entry').first().innerText()).toMatch(
      /Human[\s\S]*Moved House/,
    );
  });

  it('turns the preview red with a reason and leaves the object when the drop is rejected', async () => {
    const before = (await placement(page, 'structure:house'))!;
    const from = await screenPoint(page, 'module:house/base');
    const to = await projectPoint(page, [-8, 0, before.z + 1]);
    let during: { state?: string; note: boolean; text: string } | undefined;
    await dragTo(page, from, to, async () => {
      await poll(() =>
        editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')?.state),
      ).toBe('blocked');
      during = {
        state: 'blocked',
        note: await page.locator('.cursor-note').isVisible(),
        text: await page.locator('.cursor-note').innerText(),
      };
    });
    expect(during?.note).toBe(true);
    expect(during?.text).toMatch(/Can't place it here[\s\S]*Out of bounds/);
    await poll(() => page.locator('.toast-text').first().innerText()).toMatch(
      /House was not moved/,
    );
    expect(await placement(page, 'structure:house')).toEqual(before);
    expect(
      await editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')),
    ).toBeUndefined();
    expect(await page.locator('.cursor-note').isVisible()).toBe(false);
  });

  it('rotates the selection 15 degrees with R', async () => {
    await page.keyboard.press('Escape');
    await page.mouse.click(
      ...(Object.values(await screenPoint(page, 'module:house/base')) as [number, number]),
    );
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
    await page.keyboard.press('r');
    await poll(async () => Math.round((await placement(page, 'structure:house'))!.yaw)).toBe(15);
  });

  it('rotates the dragged preview with R before dropping', async () => {
    const from = await screenPoint(page, 'module:overlap_b/base');
    const before = (await placement(page, 'structure:overlap_b'))!;
    const to = await projectPoint(page, [before.x + 1, 0, before.z + 12]);
    await dragTo(page, from, to, async () => {
      await page.keyboard.press('r');
      await page.keyboard.press('r');
      await page.waitForTimeout(200);
    });
    await poll(async () => Math.round((await placement(page, 'structure:overlap_b'))!.yaw)).toBe(
      30,
    );
  });

  it('deletes with Delete, then undoes and redoes with Ctrl+Z and Ctrl+Y', async () => {
    const exists = () =>
      editorState(page, (e) =>
        e.store.state.scene.structures.some((s: { ref: string }) => s.ref === 'structure:socket_a'),
      );
    await page.mouse.click(
      ...(Object.values(await screenPoint(page, 'module:socket_a/base')) as [number, number]),
    );
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:socket_a');
    await page.keyboard.press('Delete');
    await poll(exists).toBe(false);
    expect(await editorState(page, (e) => e.store.state.selection)).toBeUndefined();
    await page.keyboard.press('Control+z');
    await poll(exists).toBe(true);
    await page.keyboard.press('Control+y');
    await poll(exists).toBe(false);
    await page.keyboard.press('Control+Shift+z');
    await poll(() => page.locator('.toast-text').first().innerText()).toBe('Nothing to redo');
    const history = await editorState(page, (e) => e.store.state.history);
    expect(history.cursor).toBe(history.entries.length);
    await page.locator('.history .chip-button').first().click();
    await poll(exists).toBe(true);
    expect(await page.locator('.history-entry[data-undone="true"]').count()).toBe(1);
  });

  it('deletes a single module after a second click', async () => {
    const point = await screenPoint(page, 'module:off_grid/base');
    await page.mouse.click(point.x, point.y);
    await page.mouse.click(point.x, point.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe(
      'module:off_grid/base',
    );
    await page.keyboard.press('Delete');
    await poll(() =>
      editorState(
        page,
        (e) =>
          e.store.state.scene.structures.find(
            (s: { ref: string }) => s.ref === 'structure:off_grid',
          )?.instances.length,
      ),
    ).toBe(0);
  });

  it('cancels a drag with Escape', async () => {
    const before = (await placement(page, 'structure:out_of_bounds'))!;
    const from = await screenPoint(page, 'module:out_of_bounds/base');
    const to = await projectPoint(page, [before.x - 20, 0, before.z + 20]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.keyboard.press('Escape');
    expect(
      await editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')),
    ).toBeUndefined();
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await placement(page, 'structure:out_of_bounds')).toEqual(before);
  });
});
