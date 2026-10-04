import { afterEach, describe, expect, it } from 'vitest';
import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseProject, compileMap } from '@mapedit/core';
import { createMcpHttpHandler, type AgentServices } from '../src/mcp.js';
import { ScreenshotService, findBrowser } from '../src/screenshot.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const parsed = parseProject({
    'project.yaml': 'name: MCP test\n',
    'modules/block/module.yaml':
      'id: block\nsize: [2, 2, 2]\nsockets:\n  - {id: edge, type: wall, position: [1, 1, 0], direction: north}\n',
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/house.yaml':
      'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
  });
  const compiled = compileMap(parsed, 'village');
  let flushes = 0,
    terrainCalls = 0,
    exportCalls = 0;
  const services: AgentServices = {
    async flush() {
      flushes++;
    },
    async getScene() {
      return compiled.scene;
    },
    async getScenes() {
      return [compiled.scene];
    },
    async getCompilation() {
      return compiled;
    },
    getModules() {
      return Object.values(parsed.modules);
    },
    compatibleSocketTypes() {
      return ['wall'];
    },
    async query(_map, x, z) {
      return { x, z, height: 0, surface: 'grass', objects: [] };
    },
    async buildModule(id) {
      return {
        summary: { id, ok: true },
        preview: await screenshots.capture('village', { views: ['top'], tileSize: 128 }),
      };
    },
    async terrain() {
      terrainCalls++;
      return { ok: true };
    },
    async export() {
      exportCalls++;
      return { ok: true, path: 'village.glb' };
    },
  };
  const html = await readFile(new URL('./fixtures/render/index.html', import.meta.url));
  const server = httpServer((request, response) => {
    void (async () => {
      if (request.url?.startsWith('/mcp')) {
        await handler.handle(request, response);
        return;
      }
      if (request.url?.startsWith('/api/scene')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(compiled.scene));
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end(html);
    })().catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('No port');
  const url = `http://127.0.0.1:${address.port}`;
  const screenshots = new ScreenshotService(url);
  const handler = createMcpHttpHandler(services, screenshots);
  cleanup.push(async () => {
    await handler.close();
    await screenshots.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url, counts: () => ({ flushes, terrainCalls, exportCalls }) };
}
const browserAvailable = Boolean(await findBrowser());
describe('MCP transports and screenshot page contract', () => {
  for (const transport of ['http', 'stdio'] as const)
    it(`tests all fixed tools through SDK ${transport} client`, async () => {
      const { url, counts } = await fixture();
      const client = new Client({ name: 'contract-test', version: '1' });
      await client.connect(
        transport === 'http'
          ? new StreamableHTTPClientTransport(new URL('/mcp', url))
          : new StdioClientTransport({
              command: process.execPath,
              args: [fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url)), url],
              stderr: 'pipe',
            }),
      );
      cleanup.push(() => client.close());
      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual(
        [
          'build_module',
          'check',
          'export',
          'floor_plan',
          'free_sockets',
          'modules',
          'overview',
          'query',
          'screenshot',
          'terrain',
        ].sort(),
      );
      const calls: Array<[string, Record<string, unknown>]> = [
        ['overview', {}],
        ['check', {}],
        ['floor_plan', { structure: 'house' }],
        ['query', { x: 10, z: 10 }],
        ['free_sockets', { structure: 'house' }],
        ['modules', {}],
        [
          'terrain',
          {
            command: {
              operation: 'raise',
              amount: 0.5,
              region: { kind: 'circle', center: [10, 10], radius: 2 },
            },
          },
        ],
        ['export', { out: './export' }],
      ];
      for (const [name, args] of calls) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, `${transport} ${name}: ${JSON.stringify(result)}`).not.toBe(true);
        expect(result.content).toBeDefined();
      }
      if (browserAvailable) {
        for (const [name, args] of [
          ['screenshot', { structure: 'house', tileSize: 128 }],
          ['build_module', { module: 'block' }],
        ] as Array<[string, Record<string, unknown>]>) {
          const result = await client.callTool({ name, arguments: args });
          expect(result.isError, JSON.stringify(result)).not.toBe(true);
          expect(result.structuredContent).toBeUndefined();
          const image = (result.content as Array<{ type: string; data?: string }>).find(
            (item) => item.type === 'image',
          );
          expect(Buffer.from(image!.data!, 'base64').subarray(0, 8).toString('hex')).toBe(
            '89504e470d0a1a0a',
          );
        }
      }
      const invalid = await client.callTool({ name: 'query', arguments: { x: 'bad', z: 0 } });
      expect(invalid.isError).toBe(true);
      expect(counts().terrainCalls).toBe(1);
      expect(counts().exportCalls).toBe(1);
      expect(counts().flushes).toBeGreaterThanOrEqual(8);
    });
  it.skipIf(!browserAvailable)(
    'uses the requested revision and returns the five-view montage dimensions',
    async () => {
      const { url } = await fixture();
      const service = new ScreenshotService(url);
      cleanup.push(() => service.close());
      const png = await service.capture('village', {
        views: ['top', 'ne', 'nw', 'se', 'sw'],
        tileSize: 128,
        minRevision: 0,
        focus: { center: [10, 0, 10], radius: 5 },
      });
      expect(png.readUInt32BE(16)).toBe(640);
      expect(png.readUInt32BE(20)).toBe(128);
    },
  );
});
