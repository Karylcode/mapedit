import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { createServer, type MapeditServer } from '@mapedit/server';
import { buildWeb, findBrowser, launch, openEditor } from './browser/harness.js';

const executable = await findBrowser();

describe.skipIf(!executable)('editor keyboard shortcuts in a real browser', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    server = await createServer({ mock: true, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url);
    // Record what the editor asks the backend for, without sending it.
    await page.evaluate(() => {
      const editor = (
        globalThis as unknown as {
          mapeditEditor: { connection: { request(m: { type: string }): number | undefined } };
        }
      ).mapeditEditor;
      const log: string[] = [];
      (globalThis as unknown as { requested: string[] }).requested = log;
      editor.connection.request = (message) => {
        log.push(message.type);
        return undefined;
      };
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
  });

  /** Dispatch keydown events as a given keyboard layout reports them, and return the requests made. */
  const press = (events: KeyboardEventInit[]) =>
    page.evaluate((list) => {
      const log = (globalThis as unknown as { requested: string[] }).requested;
      log.length = 0;
      for (const init of list)
        window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
      return log.slice();
    }, events);

  it('undoes once while Ctrl+Z is held down (FE6)', async () => {
    const held = { key: 'z', code: 'KeyZ', ctrlKey: true };
    expect(await press([held, { ...held, repeat: true }, { ...held, repeat: true }])).toEqual([
      'undo',
    ]);
    const redo = { key: 'y', code: 'KeyY', ctrlKey: true };
    expect(await press([redo, { ...redo, repeat: true }])).toEqual(['redo']);
  });

  it('follows the letter printed on the key, not its position (FE7)', async () => {
    // German QWERTZ: the key printed Z sits where QWERTY has Y, and the other way round.
    expect(await press([{ key: 'z', code: 'KeyY', ctrlKey: true }])).toEqual(['undo']);
    expect(await press([{ key: 'y', code: 'KeyZ', ctrlKey: true }])).toEqual(['redo']);
    // French AZERTY: the key printed Z is where QWERTY has W.
    expect(await press([{ key: 'z', code: 'KeyW', ctrlKey: true }])).toEqual(['undo']);
    expect(await press([{ key: 'Z', code: 'KeyW', ctrlKey: true, shiftKey: true }])).toEqual([
      'redo',
    ]);
  });
});
