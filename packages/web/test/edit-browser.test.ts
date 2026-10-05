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
  pageErrors,
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
    await dragTo(page, from, to, async () => {
      // The backend answers the previews; wait for the one where the pointer stopped.
      await poll(() =>
        editorState(page, (e) => {
          const object = e.viewport.scene.getObjectByName('ghost');
          return object && { state: object.state, visible: object.visible };
        }),
      ).toEqual({ state: 'ok', visible: true });
    });
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
    // On the map's east edge it sits under the change log; bring it to the middle.
    await editorState(page, (e) => {
      e.viewport.overview.target.set(90, 0, 15);
      e.viewport.invalidate();
    });
    const from = await screenPoint(page, 'module:out_of_bounds/base');
    const to = await projectPoint(page, [before.x - 10, 0, before.z + 10]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    // The drag really started: its preview is on screen before Escape.
    await poll(() =>
      editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')?.name),
    ).toBe('ghost');
    await page.keyboard.press('Escape');
    expect(
      await editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')),
    ).toBeUndefined();
    await page.mouse.up();
    // Nothing is dropped: give a wrongly sent edit time to arrive, then check.
    await page.waitForTimeout(200);
    expect(await placement(page, 'structure:out_of_bounds')).toEqual(before);
    await lookDown(page);
  });

  for (const interruption of ['pointercancel', 'lostpointercapture', 'blur'] as const)
    it(`drops a drag the browser interrupts with ${interruption} (FE8)`, async () => {
      const ghost = () => editorState(page, (e) => e.viewport.scene.getObjectByName('ghost')?.name);
      const from = await screenPoint(page, 'module:house/base');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + 30, { steps: 6 });
      await poll(ghost).toBe('ghost');
      await page.evaluate((type) => {
        const canvas = document.querySelector('canvas')!;
        if (type === 'blur') window.dispatchEvent(new FocusEvent('blur'));
        else canvas.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true }));
      }, interruption);
      await poll(ghost).toBeUndefined();
      expect(await editorState(page, (e) => e.edits.dragging)).toBe(false);
      await page.mouse.up();
      // Keys work again: Delete reaches the selected house.
      const requests = await page.evaluate(() => {
        const editor = (
          globalThis as unknown as {
            mapeditEditor: { connection: { request(m: { type: string }): number | undefined } };
          }
        ).mapeditEditor;
        const log: string[] = [];
        const original = editor.connection.request.bind(editor.connection);
        editor.connection.request = (message) => (log.push(message.type), undefined);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        editor.connection.request = original;
        return log;
      });
      expect(requests).toEqual(['applyEdit']);
    });

  it('rotates the other way with Shift+R (FE21)', async () => {
    await page.keyboard.press('Escape');
    const house = await screenPoint(page, 'module:house/base');
    await page.mouse.click(house.x, house.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:house');
    const before = (await placement(page, 'structure:house'))!.yaw;
    await page.keyboard.press('Shift+R');
    const turned = async () => {
      const yaw = (await placement(page, 'structure:house'))!.yaw;
      return Math.round(((((yaw - before) % 360) + 540) % 360) - 180);
    };
    await poll(turned).toBe(-15);
  });

  it('deletes with Backspace as well as Delete (FE21)', async () => {
    const exists = () =>
      editorState(page, (e) =>
        e.store.state.scene.structures.some((s: { ref: string }) => s.ref === 'structure:socket_b'),
      );
    const socket = await screenPoint(page, 'module:socket_b/base');
    await page.mouse.click(socket.x, socket.y);
    await poll(() => editorState(page, (e) => e.store.state.selection)).toBe('structure:socket_b');
    await page.keyboard.press('Backspace');
    await poll(exists).toBe(false);
  });

  it('bases a drop on the revision its drag started from (FE21)', async () => {
    await page.evaluate(() => {
      const editor = (
        globalThis as unknown as {
          mapeditEditor: { connection: { request(m: object): number | undefined } };
        }
      ).mapeditEditor;
      const sent: object[] = [];
      (globalThis as unknown as { sentRequests: object[] }).sentRequests = sent;
      const original = editor.connection.request.bind(editor.connection);
      editor.connection.request = (message) => (sent.push(message), original(message));
    });
    const revision = () => editorState(page, (e) => e.store.state.revision as number);
    const from = await screenPoint(page, 'module:house/base');
    const to = await projectPoint(page, [60, 0, 60]);
    const started = await revision();
    await dragTo(page, from, to, async () => {
      // The Agent moves the house while the human is still dragging it.
      const response = await fetch(`${server.url}/api/mock/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice: 'agent_changed' }),
      });
      expect(response.status).toBe(200);
      await poll(revision).toBeGreaterThan(started);
    });
    const drop = await page.evaluate(() =>
      (
        globalThis as unknown as { sentRequests: { type: string; baseRevision?: number }[] }
      ).sentRequests
        .filter((message) => message.type === 'applyEdit')
        .at(-1),
    );
    expect(drop?.baseRevision).toBe(started);
    // So the backend knows the drop replaced the Agent's change, and says so.
    await poll(() => page.locator('.toast-text').allInnerTexts()).toContain(
      'Your drop replaced the change the Agent made to House while you were dragging',
    );
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
