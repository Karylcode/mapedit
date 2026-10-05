import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createServer, findWebRoot } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function directory(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-web-root-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  return root;
}
const project = () =>
  directory({
    'project.yaml': 'name: Web root\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
  });
const fakeEditor = () =>
  directory({
    'index.html': '<!doctype html><title>Fake editor build</title>',
    // The editor build keeps its bundles in static/, since /assets/ belongs to the backend.
    'static/app.js': 'console.log("editor");',
  });
const missing = 'The editor web build is missing; run pnpm build.';

describe('F33 the editor web build', () => {
  it('serves a given web build at / and at front-end routes such as /render', async () => {
    const server = await createServer({
      root: await project(),
      port: 0,
      webRoot: await fakeEditor(),
    });
    cleanup.push(() => server.close());
    for (const path of ['/', '/render?map=village'])
      expect(await (await fetch(`${server.url}${path}`)).text()).toContain('Fake editor build');
    expect(await (await fetch(`${server.url}/static/app.js`)).text()).toContain('editor');
  });

  it('answers screenshot and build_module at once when there is no web build', async () => {
    const server = await createServer({ root: await project(), port: 0, webRoot: null });
    cleanup.push(() => server.close());
    expect(await (await fetch(`${server.url}/`)).text()).toContain('Build packages/web');
    const client = new Client({ name: 'web-root-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    const started = Date.now();
    const screenshot = (await client.callTool({
      name: 'screenshot',
      arguments: { map: 'village', views: ['top'], tileSize: 64 },
    })) as CallToolResult;
    expect(screenshot.isError).toBe(true);
    expect((screenshot.content[0] as { text: string }).text).toBe(missing);
    const built = (await client.callTool({
      name: 'build_module',
      arguments: { module: 'block' },
    })) as CallToolResult;
    expect(built.isError).toBeFalsy();
    expect(JSON.parse((built.content[0] as { text: string }).text)).toMatchObject({
      module: 'block',
      ok: true,
      previewError: missing,
    });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('finds the first directory that holds a built editor', async () => {
    const empty = await directory({ 'readme.txt': 'no editor here' });
    const first = await fakeEditor();
    const second = await fakeEditor();
    expect(await findWebRoot(join(empty, 'absent'), empty, first, second)).toBe(first);
    expect(await findWebRoot(join(empty, 'absent'), empty)).toBeUndefined();
  });
});
