import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/index.js';
import { findBrowser } from '../src/screenshot.js';
import type { ServerMessage } from '@mapedit/protocol';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(count = 1, mapId = 'village') {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-real-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files = {
    'project.yaml': 'name: Real project\n',
    'modules/block/module.yaml':
      'id: block\nsize: [2, 2, 2]\nsockets:\n  - {id: top, type: foundation, position: [1, 2, 1], direction: up}\n',
    'modules/block/model.ts':
      "import {box,material} from '@mapedit/model';export default material('wood_planks',box([2,2,2]));",
    'maps/village/map.yaml': `id: ${mapId}\nname: Village\nsize: {x: 100, z: 100}\n`,
    'maps/village/structures/house.yaml':
      '# Preserve note\nstructures:\n' +
      Array.from(
        { length: count },
        (_, i) =>
          `  - id: house${i}\n    position: [${10 + (i % 8) * 4}, ${10 + Math.floor(i / 8) * 4}]\n    rotation: 0\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n`,
      ).join(''),
    'maps/village/markers.yaml': 'markers: []\n',
  };
  for (const [file, data] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), data);
  }
  const server = await createServer({
    port: 0,
    root,
    webRoot: fileURLToPath(new URL('./fixtures/render', import.meta.url)),
  });
  cleanup.push(() => server.close());
  return { root, server };
}
const hasBrowser = Boolean(await findBrowser());
describe('real backend integration', () => {
  it('serializes concurrent terrain edits and uses the map source directory when its id differs', async () => {
    const { root, server } = await fixture(1, 'renamed');
    const client = new Client({ name: 'concurrent-terrain', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    const args = {
      map: 'renamed',
      command: {
        operation: 'raise',
        amount: 0.5,
        region: { kind: 'circle', center: [50, 50], radius: 3 },
      },
    };
    const results = await Promise.all([
      client.callTool({ name: 'terrain', arguments: args }),
      client.callTool({ name: 'terrain', arguments: args }),
    ]);
    for (const result of results) expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const query = async () => {
      const result = await client.callTool({
        name: 'query',
        arguments: { map: 'renamed', x: 50, z: 50 },
      });
      return JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as { height: number };
    };
    expect((await query()).height).toBe(1);
    expect(server.state.entries).toHaveLength(2);
    expect(
      await readFile(join(root, 'maps/village/terrain/height.png')).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    expect(
      await readFile(join(root, 'maps/renamed/terrain/height.png')).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await server.state.travel(-1);
    expect((await query()).height).toBe(0.5);
    await server.state.travel(1);
    expect((await query()).height).toBe(1);
  });
  for (const transport of ['http', 'stdio'] as const)
    it(`runs all MCP tools against real files over ${transport}`, async () => {
      const { root, server } = await fixture();
      const client = new Client({ name: 'real-test', version: '1' });
      await client.connect(
        transport === 'http'
          ? new StreamableHTTPClientTransport(new URL('/mcp', server.url))
          : new StdioClientTransport({
              command: process.execPath,
              args: [
                fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url)),
                server.url,
              ],
              stderr: 'pipe',
            }),
      );
      cleanup.push(() => client.close());
      const call = async (name: string, args: Record<string, unknown> = {}) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, JSON.stringify(response)).not.toBe(true);
        return response;
      };
      expect((await client.listTools()).tools).toHaveLength(10);
      await call('overview');
      const checked = await call('check');
      expect(JSON.parse((checked.content as Array<{ text: string }>)[0]!.text).maps[0].ok).toBe(
        true,
      );
      await call('floor_plan', { structure: 'house0' });
      await call('modules');
      await call('free_sockets', { structure: 'house0' });
      await call('query', { x: 10, z: 10 });
      // Immediate check after writing source must never return a stale cached result.
      const structure = join(root, 'maps/village/structures/house.yaml');
      const original = await readFile(structure, 'utf8');
      await writeFile(structure, original.replace('[10, 10]', '[-10, 10]'));
      const invalid = await call('check');
      expect(JSON.parse((invalid.content as Array<{ text: string }>)[0]!.text).maps[0].ok).toBe(
        false,
      );
      const denied = await client.callTool({ name: 'export', arguments: { out: 'export' } });
      expect(denied.isError).toBe(true);
      await writeFile(structure, original);
      await call('check');
      for (const command of [
        {
          operation: 'raise',
          amount: 0.5,
          region: { kind: 'circle', center: [70, 70], radius: 3 },
        },
        {
          operation: 'lower',
          amount: 0.5,
          region: { kind: 'rectangle', min: [68, 68], max: [72, 72] },
        },
        {
          operation: 'flatten',
          height: 0,
          region: { kind: 'rectangle', min: [65, 65], max: [75, 75] },
        },
        {
          operation: 'set_height',
          height: 0.5,
          region: { kind: 'circle', center: [80, 80], radius: 2 },
        },
        {
          operation: 'mountain',
          height: 3,
          region: { kind: 'circle', center: [80, 80], radius: 4 },
        },
        {
          operation: 'paint',
          surface: 'gravel',
          region: {
            kind: 'path',
            points: [
              [60, 60],
              [70, 60],
            ],
            width: 2,
          },
        },
      ])
        await call('terrain', { command });
      expect(
        (await readFile(join(root, 'maps/village/terrain/height.png')))
          .subarray(0, 8)
          .toString('hex'),
      ).toBe('89504e470d0a1a0a');
      await call('export', { out: 'export' });
      expect((await readFile(join(root, 'export/village.glb'))).readUInt32LE(0)).toBe(0x46546c67);
      if (hasBrowser) {
        for (const [name, args] of [
          ['screenshot', { structure: 'house0', tileSize: 128 }],
          ['build_module', { module: 'block' }],
        ] as Array<[string, Record<string, unknown>]>) {
          const response = await call(name, args);
          expect(response.structuredContent).toBeUndefined();
          expect(
            (response.content as Array<{ type: string }>).some((item) => item.type === 'image'),
          ).toBe(true);
        }
      }
    });
  it('previews a village over WebSocket within 30 ms after warmup and refuses real overlaps', async () => {
    const { server } = await fixture(24);
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
    cleanup.push(async () => {
      socket.terminate();
    });
    await new Promise<void>((resolve) => socket.once('open', resolve));
    let id = 0;
    const request = async (message: Record<string, unknown>, type: ServerMessage['type']) => {
      const requestId = ++id;
      const promise = new Promise<ServerMessage>((resolve) => {
        const handle = (data: Buffer) => {
          const result = JSON.parse(data.toString()) as ServerMessage;
          if (
            result.type === type &&
            (!('requestId' in result) || result.requestId === requestId)
          ) {
            socket.off('message', handle);
            resolve(result);
          }
        };
        socket.on('message', handle);
      });
      socket.send(JSON.stringify({ ...message, requestId }));
      return promise;
    };
    await request({ type: 'hello', protocolVersion: 1, client: 'editor' }, 'welcome');
    await request({ type: 'openMap', mapId: 'village' }, 'scene');
    const edit = { kind: 'move', ref: 'structure:house0', position: [9.2, 0, 9.2], rotation: 0 };
    for (let i = 0; i < 2; i++) await request({ type: 'previewEdit', edit }, 'previewResult');
    const timings = [];
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const result = await request({ type: 'previewEdit', edit }, 'previewResult');
      timings.push(performance.now() - start);
      expect(result).toMatchObject({ ok: true });
    }
    const median = timings.sort((a, b) => a - b)[4]!;
    expect(median, `Warm preview round trip median ${median.toFixed(2)}ms`).toBeLessThan(30);
    const rejected = await request(
      { type: 'applyEdit', baseRevision: 0, edit: { ...edit, position: [14, 0, 10] } },
      'editResult',
    );
    expect(rejected).toMatchObject({ ok: false });
  });
});
