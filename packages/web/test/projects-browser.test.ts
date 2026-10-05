import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  openEditor,
  pageErrors,
  waitForEditor,
} from './browser/harness.js';

const executable = await findBrowser();
const template = fileURLToPath(new URL('../../../templates/project/', import.meta.url));

describe.skipIf(!executable)('switching projects from the title block', () => {
  let web: Awaited<ReturnType<typeof buildWeb>>;
  let directory: string;
  let server: MapeditServer;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    web = await buildWeb();
    directory = await mkdtemp(join(tmpdir(), 'mapedit-projects-'));
    for (const [folder, name] of [
      ['harbor', 'Harbor Town'],
      ['monastery', 'Hill Monastery'],
    ] as const) {
      const root = join(directory, folder);
      await cp(template, root, { recursive: true });
      const yaml = await readFile(join(root, 'project.yaml'), 'utf8');
      await writeFile(join(root, 'project.yaml'), yaml.replace(/^name: .*$/m, `name: ${name}`));
    }
    server = await createServer({
      port: 0,
      root: join(directory, 'harbor'),
      webRoot: web.dir,
      projects: { directory },
    });
    browser = await launch(executable!);
    page = await openEditor(browser, server.url);
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    await web?.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const menu = () =>
    page.evaluate(() => {
      const select = document.querySelector<HTMLSelectElement>('select.tb-project-menu')!;
      return {
        hidden: select.hidden,
        value: select.value,
        options: [...select.options].map((option) => option.textContent),
      };
    });

  it('lists the projects and opens another one, starting from its first map', async () => {
    expect(await menu()).toEqual({
      hidden: false,
      value: 'harbor',
      options: ['Harbor Town', 'Hill Monastery'],
    });
    await page.selectOption('select.tb-project-menu', 'monastery');
    await page.waitForFunction(
      () =>
        (
          globalThis as unknown as {
            mapeditEditor?: { store: { state: { project?: { id?: string } } } };
          }
        ).mapeditEditor?.store.state.project?.id === 'monastery',
      undefined,
      { timeout: 30_000 },
    );
    await waitForEditor(page);
    expect(await menu()).toMatchObject({ value: 'monastery' });
    expect(await page.locator('.title-block').innerText()).toMatch(/Hill Monastery/);
    expect(await editorState(page, (e) => e.store.state.mapId)).toBe('village');
  });

  it('shows a project created while the page is open once the pointer reaches the menu', async () => {
    const root = join(directory, 'quarry');
    await cp(template, root, { recursive: true });
    await writeFile(join(root, 'project.yaml'), 'name: Old Quarry\n');
    await page.hover('.title-block .tb-stack');
    await page.waitForFunction(
      () => document.querySelectorAll('select.tb-project-menu option').length === 3,
    );
    expect((await menu()).options).toEqual(['Harbor Town', 'Hill Monastery', 'Old Quarry']);
  });

  it('reports no page or console errors', () => {
    expect(pageErrors(page)).toEqual([]);
  });
});
