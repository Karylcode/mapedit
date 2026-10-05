import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { createServer, type MapeditServer } from '@mapedit/server';
import type { NoticeCode } from '@mapedit/protocol';
import {
  buildWeb,
  editorState,
  findBrowser,
  launch,
  openEditor,
  poll,
  pageErrors,
} from './browser/harness.js';

const executable = await findBrowser();

describe.skipIf(!executable)('violations, notices and language in a real browser', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    server = await createServer({ mock: true, port: 0, webRoot: web.dir });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url, 'zh-TW');
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
  });

  const trigger = (notice: NoticeCode) =>
    page.evaluate(
      (code) =>
        fetch('/api/mock/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notice: code }),
        }).then((response) => response.status),
      notice,
    );

  it('follows the browser language: Traditional Chinese for a zh-TW browser', async () => {
    expect(await page.locator('html').getAttribute('lang')).toBe('zh-TW');
    expect(await page.locator('.title-block').innerText()).toMatch(
      /專案[\s\S]*地圖[\s\S]*即時同步/,
    );
  });

  it('lists every violation kind with its objects, suggestion and source line', async () => {
    const titles = await page.locator('.issue-title strong').allInnerTexts();
    expect(titles.sort()).toEqual(
      [
        '穿模',
        '插槽不相容',
        '沒有支撐',
        '不在格子上',
        '角度不合規定',
        '超出地圖',
        '找不到引用',
      ].sort(),
    );
    const first = await page.locator('.issue').first().innerText();
    expect(first).toMatch(/overlap_a/);
    expect(first).toMatch(/建議：Move structure:overlap_a/);
    expect(first).toMatch(/maps\/village\/structures\/overlap_a\.yaml:3/);
    expect(await page.locator('.file-error').innerText()).toMatch(
      /maps\/village\/structures\/broken\.yaml:2[\s\S]*Invalid YAML/,
    );
  });

  it('flies to a violation, enlarges its flag and outlines its objects when clicked', async () => {
    const before = await editorState(page, (e) => e.viewport.overview.target.toArray());
    await page.locator('.issue').nth(1).click();
    // The flight ends over the unsupported structure.
    await poll(() => editorState(page, (e) => e.viewport.overview.target.x), {
      timeout: 3000,
    }).toBeCloseTo(51, 0);
    const state = await editorState(page, (e) => ({
      target: e.viewport.overview.target.toArray(),
      focus: e.map.outlines.focus.refs,
      focused: e.store.state.focusedViolation,
      unsupported: e.store.state.scene.violations.find(
        (v: { kind: string }) => v.kind === 'unsupported',
      ).id,
    }));
    expect(state.focused).toBe(state.unsupported);
    expect(state.target).not.toEqual(before);
    expect(state.target[0]).toBeCloseTo(51, 0);
    expect(state.focus).toEqual(['module:unsupported/base']);
    expect(await page.locator('.issue').nth(1).getAttribute('aria-pressed')).toBe('true');
    await page.keyboard.press('Escape');
    await poll(() => editorState(page, (e) => e.store.state.focusedViolation)).toBeUndefined();
  });

  it('shows every notice code in the interface language', async () => {
    const expected: [NoticeCode, RegExp][] = [
      ['agent_changed', /Agent 修改了 House/],
      ['overwritten_by_agent', /你剛才對 House 的修改，被 Agent 後來的修改蓋掉了/],
      ['agent_change_overridden', /你放下的位置，蓋掉了 Agent 在你拖動時對 House 的修改/],
      ['edit_rejected', /House 的修改沒有套用/],
      ['file_error', /有檔案無法讀取/],
    ];
    for (const [code, text] of expected) {
      expect(await trigger(code)).toBe(200);
      await poll(async () =>
        (await page.locator('.toast-text').allInnerTexts()).join('\n'),
      ).toMatch(text);
    }
    // file_error also adds a file error to the next snapshot.
    await poll(() => page.locator('.file-error').count()).toBe(2);
  });

  it('switches every interface text to English and remembers the choice', async () => {
    await page.getByRole('button', { name: 'English' }).click();
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
    expect(await page.locator('.title-block').innerText()).toMatch(/Project[\s\S]*Map[\s\S]*Live/i);
    expect(await page.locator('.issues .panel-title').innerText()).toBe('Violations');
    expect(await page.locator('.history .panel-title').innerText()).toBe('Change log');
    expect(await page.locator('.action-bar').innerText()).toMatch(/Orbit/);
    const titles = await page.locator('.issue-title strong').allInnerTexts();
    expect(titles).toContain('Overlap');
    expect(titles).toContain('Missing reference');
    const toasts = (await page.locator('.toast-text').allInnerTexts()).join('\n');
    expect(toasts).not.toMatch(/[一-鿿]/);
    expect(toasts).toMatch(/A file could not be read/);
    expect(await page.locator('.history-author').first().innerText()).toMatch(/Agent|Human/);
    // Nothing in the interface is Chinese now, labels included, except the switch back to 中文.
    const texts = await page.evaluate(() => {
      const hud = document.querySelector<HTMLElement>('.hud')!;
      const switcher = hud.querySelector<HTMLElement>('.tb-lang')!;
      switcher.style.display = 'none';
      const visible = hud.innerText;
      switcher.style.display = '';
      const labels = [...hud.querySelectorAll('[aria-label], [title]')]
        .filter((element) => !switcher.contains(element) || element === switcher)
        .map((element) => [element.getAttribute('aria-label'), element.getAttribute('title')]);
      return [visible, ...labels.flat().filter((label): label is string => Boolean(label))];
    });
    expect(texts.length).toBeGreaterThan(5);
    for (const text of texts) expect(text).not.toMatch(/\p{Script=Han}/u);
    expect(await page.evaluate(() => localStorage.getItem('mapedit.lang'))).toBe('en');
    await page.reload();
    await page.waitForFunction(() =>
      Boolean((globalThis as { mapeditEditor?: unknown }).mapeditEditor),
    );
    expect(await page.locator('html').getAttribute('lang')).toBe('en');
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
