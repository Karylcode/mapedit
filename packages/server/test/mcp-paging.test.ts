import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { parseProject, compileMap } from '@mapedit/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpHttpHandler, type AgentServices } from '../src/mcp.js';
import { ScreenshotService } from '../src/screenshot.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});
const large = '漢😀"\\\n'.repeat(6000);
const tools: Array<[string, Record<string, unknown>]> = [
  ['overview', {}],
  ['check', {}],
  ['floor_plan', { structure: 'house' }],
  ['query', { x: 0, z: 0 }],
  ['free_sockets', { structure: 'house' }],
  ['modules', {}],
  ['build_module', { module: 'block' }],
  [
    'terrain',
    {
      command: {
        operation: 'raise',
        amount: 0.5,
        region: { kind: 'circle', center: [0, 0], radius: 1 },
      },
    },
  ],
  ['export', { out: 'export' }],
  ['screenshot', {}],
];
type Page = { paging: { fragment: string; nextCursor: string | null; totalCharacters: number } };
function resultText(result: CallToolResult): string {
  expect(result.structuredContent).toBeUndefined();
  const text = result.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('');
  expect(text.length).toBeLessThanOrEqual(24_000);
  return text;
}
function firstPage(result: CallToolResult): Page {
  const page = JSON.parse(resultText(result)) as Page;
  expect(page.paging?.nextCursor).toEqual(expect.any(String));
  return page;
}
async function fixture(options: { error?: boolean; small?: boolean } = {}) {
  const parsed = parseProject({
    'project.yaml': 'name: Paging\n',
    'modules/block/module.yaml':
      'size: [2, 2, 2]\nsockets:\n  - {id: edge, type: wall, position: [1, 1, 0], direction: north}\n',
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/house.yaml':
      'structures:\n  - id: house\n    position: [10, 10]\n    modules: [{id: base, module: block, at: [0, 0, 0]}]\n',
  });
  const compilation = compileMap(parsed, 'village');
  const detail = { value: options.small ? 'small' : large };
  const instance = compilation.scene.structures[0]!.instances[0]!;
  instance.ref += large;
  compilation.sockets[0]!.instanceRef = instance.ref;
  compilation.sockets[0]!.ref += large;
  compilation.scene.structures[0]!.name = large;
  compilation.scene.violations = [
    { id: 'large', kind: 'off_grid', message: large, refs: [instance.ref], params: {} },
  ];
  parsed.modules['block']!.name = large;
  const counts = { flush: 0, terrain: 0, export: 0, build: 0, query: 0 };
  class Screenshots extends ScreenshotService {
    override async capture(): Promise<Buffer> {
      throw new Error(large);
    }
  }
  const screenshots = new Screenshots('http://unused');
  const services: AgentServices = {
    async flush() {
      counts.flush++;
      if (options.error) throw new Error(large);
    },
    async getScene() {
      return compilation.scene;
    },
    async getScenes() {
      return [compilation.scene];
    },
    async getCompilation() {
      return compilation;
    },
    getModules() {
      return Object.values(parsed.modules);
    },
    compatibleSocketTypes() {
      return ['wall'];
    },
    async query() {
      counts.query++;
      return { detail: detail.value };
    },
    async buildModule() {
      counts.build++;
      return { summary: { detail: detail.value }, preview: Buffer.from('test-png') };
    },
    async terrain() {
      counts.terrain++;
      return { detail: detail.value };
    },
    async export() {
      counts.export++;
      return { detail: detail.value };
    },
  };
  const handler = createMcpHttpHandler(services, screenshots);
  const server = createServer((request, response) => {
    void handler.handle(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const client = new Client({ name: 'paging-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)),
  );
  cleanup.push(async () => {
    await client.close();
    await handler.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    call,
    counts,
    detail,
    list: () => client.listTools(),
    url: `http://127.0.0.1:${address.port}`,
  };
}
async function collect(
  call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
  name: string,
  initial: CallToolResult,
): Promise<string> {
  let result = initial;
  let combined = '';
  let pages = 0;
  while (true) {
    const page = JSON.parse(resultText(result)) as Page;
    expect(page.paging?.fragment).toEqual(expect.any(String));
    combined += page.paging.fragment;
    if (page.paging.nextCursor === null) {
      expect(combined.length).toBe(page.paging.totalCharacters);
      return combined;
    }
    expect(++pages).toBeLessThan(1000);
    result = await call(name, { cursor: page.paging.nextCursor });
    expect(result.isError).toBe(initial.isError);
    expect(result.content.some((content) => content.type === 'image')).toBe(false);
  }
}

describe('F11 bounded MCP text and captured continuation pages', () => {
  it('advertises cursor-only continuation and accurate regular required arguments', async () => {
    const { list } = await fixture();
    const definitions = (await list()).tools;
    expect(definitions).toHaveLength(10);
    for (const definition of definitions) {
      expect(definition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      expect(definition.inputSchema).not.toHaveProperty('anyOf');
      expect(definition.inputSchema.required ?? []).toEqual([]);
      expect(definition.inputSchema.properties).toHaveProperty('cursor');
      expect(definition.description).toContain('Continue with only {"cursor":"..."}');
      if (definition.name === 'overview')
        expect(definition.description).not.toContain('Required arguments');
      if (definition.name === 'query')
        expect(definition.description).toContain('Required arguments: x, z.');
      if (definition.name === 'export')
        expect(definition.description).toContain('Required arguments: out.');
    }
  });
  for (const [name, args] of tools)
    it(`pages oversized ${name} output without discarding any text`, async () => {
      const { call, counts } = await fixture();
      const initial = await call(name, args);
      if (name !== 'screenshot') expect(initial.isError).not.toBe(true);
      else expect(initial.isError).toBe(true);
      firstPage(initial);
      const text = await collect(call, name, initial);
      if (name === 'screenshot') expect(text).toContain(large);
      else expect(JSON.stringify(JSON.parse(text))).toContain(JSON.stringify(large).slice(1, -1));
      expect(counts.flush).toBe(1);
      if (name === 'build_module') {
        expect(initial.content.filter((content) => content.type === 'image')).toHaveLength(1);
        expect(counts.build).toBe(1);
      }
      if (name === 'terrain') expect(counts.terrain).toBe(1);
      if (name === 'export') expect(counts.export).toBe(1);
    });

  for (const [name, args] of tools)
    it(`bounds and pages oversized ${name} errors`, async () => {
      const { call, counts } = await fixture({ error: true });
      const initial = await call(name, args);
      expect(initial.isError).toBe(true);
      firstPage(initial);
      expect(await collect(call, name, initial)).toContain(large);
      expect(counts.flush).toBe(1);
    });

  it('preserves small result shapes', async () => {
    const { call } = await fixture({ small: true });
    expect(JSON.parse(resultText(await call('query', { x: 0, z: 0 })))).toEqual({
      detail: 'small',
    });
  });

  it('pages schema validation errors before running a tool', async () => {
    const { call, counts } = await fixture();
    const initial = await call('query', { x: 0, z: 0, [large]: true });
    expect(initial.isError).toBe(true);
    firstPage(initial);
    const errors = JSON.parse(await collect(call, 'query', initial)) as Array<{ keys: string[] }>;
    expect(errors[0]!.keys).toEqual([large]);
    expect(counts.flush).toBe(0);
    expect(counts.query).toBe(0);
  });

  it('keeps the 10000 element input safeguard before schema validation', async () => {
    const { call, counts } = await fixture();
    const result = await call('query', {
      x: 0,
      z: 0,
      extra: Array.from({ length: 10_001 }, () => 0),
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('10000');
    expect(counts.flush).toBe(0);
  });

  it('keeps a single result larger than the cache budget pageable', async () => {
    const { call, counts, detail } = await fixture();
    detail.value = 'large-result'.repeat(450_000);
    const initial = await call('query', { x: 0, z: 0 });
    expect(initial.isError).not.toBe(true);
    const cursor = firstPage(initial).paging.nextCursor!;
    const next = await call('query', { cursor });
    expect(next.isError).not.toBe(true);
    expect((JSON.parse(resultText(next)) as Page).paging.fragment).toContain('large-result');
    expect(counts.query).toBe(1);
  });

  it('retains an immutable snapshot across HTTP requests and repeated continuations', async () => {
    const { call, counts, detail } = await fixture();
    const initial = await call('terrain', tools.find(([name]) => name === 'terrain')![1]);
    const cursor = firstPage(initial).paging.nextCursor!;
    detail.value = 'changed after first page';
    const next = await call('terrain', { cursor });
    expect(await call('terrain', { cursor })).toEqual(next);
    expect(JSON.parse(await collect(call, 'terrain', initial))).toEqual({ detail: large });
    expect(counts.terrain).toBe(1);
    expect(counts.flush).toBe(1);
  });

  it('continues captured results through the stdio bridge without replaying export', async () => {
    const { url, counts } = await fixture();
    const client = new Client({ name: 'paging-stdio-test', version: '1' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url)), url],
        stderr: 'pipe',
      }),
    );
    cleanup.push(() => client.close());
    const call = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })) as CallToolResult;
    const initial = await call('export', { out: 'export' });
    firstPage(initial);
    expect(JSON.parse(await collect(call, 'export', initial))).toEqual({ detail: large });
    expect(counts.export).toBe(1);
  });

  it('does not share captured results between service instances', async () => {
    const first = await fixture();
    const second = await fixture();
    const cursor = firstPage(await first.call('query', { x: 0, z: 0 })).paging.nextCursor!;
    const isolated = await second.call('query', { cursor });
    expect(isolated.isError).toBe(true);
    expect(resultText(isolated)).toMatch(/expired|unavailable/i);
    expect(second.counts.query).toBe(0);
  });

  it('rejects replay parameters and cursors used with another tool', async () => {
    const { call, counts } = await fixture();
    const initial = await call('export', { out: 'export' });
    const cursor = firstPage(initial).paging.nextCursor!;
    for (const [name, args] of [
      ['export', { cursor, out: 'another-output' }],
      ['terrain', { cursor }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await call(name, args);
      expect(result.isError).toBe(true);
      resultText(result);
    }
    expect(counts.export).toBe(1);
    expect(counts.terrain).toBe(0);
  });

  it('expires captured results instead of replaying a mutation', async () => {
    const { call, counts } = await fixture();
    const cursor = firstPage(await call('export', { out: 'export' })).paging.nextCursor!;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000);
    const expired = await call('export', { cursor });
    expect(expired.isError).toBe(true);
    expect(resultText(expired)).toMatch(/expired|unavailable/i);
    expect(counts.export).toBe(1);
  });

  it('bounds retained snapshots and reports evicted cursors clearly', async () => {
    const { call } = await fixture();
    const cursor = firstPage(await call('query', { x: 0, z: 0 })).paging.nextCursor!;
    for (let index = 0; index < 65; index++) await call('query', { x: 0, z: 0 });
    const evicted = await call('query', { cursor });
    expect(evicted.isError).toBe(true);
    expect(resultText(evicted)).toMatch(/expired|unavailable/i);
  });
});
