import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function connect(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-multi-map-mcp-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({
    'project.yaml': 'name: All maps\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    ...files,
  })) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  const client = new Client({ name: 'all-map-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
  cleanup.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return JSON.parse((response.content as Array<{ text: string }>)[0]!.text) as {
      maps: Array<{
        map: string | { id: string };
        ok?: boolean;
        violations: number | { items: Array<{ kind: string }> };
        fileErrors: number | { items: unknown[] };
        floating: {
          items: Array<{ ref: string; moduleType: string; position: number[] }>;
          total: number;
          nextOffset: number | null;
        };
      }>;
    };
  };
  return { server, call };
}

describe('all-map MCP reports', () => {
  it('includes a second map violation without changing the selected map', async () => {
    const { server, call } = await connect({
      'maps/a_clean/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/b_invalid/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/b_invalid/structures/house.yaml':
        'structures:\n  - id: house\n    position: [10.25, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
    });
    expect(server.state.scene.map.id).toBe('a_clean');
    const flush = vi.spyOn(server.state, 'flush');
    const check = await call('check');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(check.maps).toHaveLength(2);
    expect(check.maps[1]).toMatchObject({
      map: 'b_invalid',
      ok: false,
      violations: { items: [expect.objectContaining({ kind: 'off_grid' })] },
    });
    const overview = await call('overview');
    expect(overview.maps).toHaveLength(2);
    expect(overview.maps[1]).toMatchObject({ map: { id: 'b_invalid' }, violations: 1 });
    expect((await call('check', { map: 'b_invalid' })).maps).toHaveLength(1);
    expect((await call('overview', { map: 'b_invalid' })).maps).toHaveLength(1);
    expect(server.state.scene.map.id).toBe('a_clean');
  });
  it('keeps file errors when the project contains no valid maps', async () => {
    const { call } = await connect({ 'maps/invalid/map.yaml': 'size: [not a map size]\n' });
    const check = await call('check');
    expect(check.maps).toHaveLength(1);
    expect(check.maps[0]).toMatchObject({
      ok: false,
      fileErrors: {
        items: expect.arrayContaining([expect.objectContaining({ file: 'maps/invalid/map.yaml' })]),
      },
    });
    const overview = await call('overview');
    expect(overview.maps).toHaveLength(1);
    expect(overview.maps[0]!.fileErrors).toBeGreaterThan(0);
  });
  it('lists floating islands and grounded canFloat instances without reporting their supported houses as violations', async () => {
    const { call } = await connect({
      'modules/island/module.yaml': 'size: [4, 2, 4]\ncanFloat: true\n',
      'modules/island/model.ts': "import {box} from '@mapedit/model'; export default box([4,2,4]);",
      'maps/islands/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/islands/structures/objects.yaml': `structures:
  - id: flying
    position: [10, 10]
    height: 5
    modules:
      - {id: island, module: island, at: [0, 0, 0]}
      - {id: house, module: block, at: [1, 2, 1]}
  - id: grounded
    position: [30, 30]
    modules: [{id: island, module: island, at: [0, 0, 0]}]
`,
    });
    const floating = [
      { ref: 'module:flying/island', moduleType: 'island', position: [10, 5, 10] },
      { ref: 'module:grounded/island', moduleType: 'island', position: [30, 0, 30] },
    ];
    for (const tool of ['check', 'overview']) {
      const result = await call(tool);
      expect(result.maps[0]!.floating).toEqual({ items: floating, total: 2, nextOffset: null });
      if (tool === 'check')
        expect(result.maps[0]).toMatchObject({
          ok: true,
          violations: { items: [] },
          fileErrors: { items: [] },
        });
      else expect(result.maps[0]).toMatchObject({ violations: 0, fileErrors: 0 });
      expect((await call(tool, { limit: 1 })).maps[0]!.floating).toEqual({
        items: [floating[0]],
        total: 2,
        nextOffset: 1,
      });
      expect((await call(tool, { offset: 1, limit: 1 })).maps[0]!.floating).toEqual({
        items: [floating[1]],
        total: 2,
        nextOffset: null,
      });
    }
  });
});
