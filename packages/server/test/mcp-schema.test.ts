import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { createServer, type MapeditServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

// Anthropic and OpenAI tool definitions reject a top-level union or conditional schema.
const topLevelCombinators = ['anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else'];

async function mockServer(): Promise<MapeditServer> {
  const server = await createServer({ port: 0, mock: true });
  cleanup.push(() => server.close());
  return server;
}
async function httpClient(server: MapeditServer): Promise<Client> {
  const client = new Client({ name: 'schema-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
  cleanup.push(() => client.close());
  return client;
}
async function stdioClient(server: MapeditServer): Promise<Client> {
  const client = new Client({ name: 'schema-stdio-test', version: '1' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url)), server.url],
      stderr: 'pipe',
    }),
  );
  cleanup.push(() => client.close());
  return client;
}
function expectPlainObjectSchema(tool: Tool): void {
  const schema = tool.inputSchema as Record<string, unknown>;
  expect(schema.type, tool.name).toBe('object');
  expect(schema.properties, tool.name).toEqual(expect.any(Object));
  for (const keyword of topLevelCombinators) expect(schema, tool.name).not.toHaveProperty(keyword);
  // A continuation sends only the cursor, so no other argument can be required by the schema.
  expect(schema.required ?? [], tool.name).toEqual([]);
  expect(schema.additionalProperties, tool.name).toBe(false);
  expect((schema.properties as Record<string, unknown>).cursor, tool.name).toMatchObject({
    type: 'string',
  });
}
function text(result: CallToolResult): string {
  return result.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('');
}

describe('F17 MCP tool input schemas', () => {
  it('advertises a single top-level object schema for every tool over HTTP and stdio', async () => {
    const server = await mockServer();
    for (const client of [await httpClient(server), await stdioClient(server)]) {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(10);
      for (const tool of tools) expectPlainObjectSchema(tool);
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(Object.keys(byName.get('query')!.inputSchema.properties!).sort()).toEqual([
        'cursor',
        'map',
        'x',
        'z',
      ]);
      expect(byName.get('query')!.description).toContain('Required arguments: x, z.');
      expect(byName.get('export')!.description).toContain('Required arguments: out.');
      expect(byName.get('overview')!.description).not.toContain('Required arguments');
    }
  });

  it('enforces required arguments and cursor-only continuations at run time', async () => {
    const client = await httpClient(await mockServer());
    const missing = (await client.callTool({
      name: 'query',
      arguments: { x: 1 },
    })) as CallToolResult;
    expect(missing.isError).toBe(true);
    // F37: one sentence instead of the schema library's JSON report.
    expect(text(missing)).toBe('Missing required argument z (number).');

    const mixed = (await client.callTool({
      name: 'query',
      arguments: { cursor: 'abc', x: 1, z: 2 },
    })) as CallToolResult;
    expect(mixed.isError).toBe(true);
    expect(text(mixed)).toBe(
      'Send only {"cursor":"..."} to continue a paged result. Remove "x", "z", or run the tool again without cursor.',
    );

    const unknown = (await client.callTool({
      name: 'query',
      arguments: { cursor: 'abc' },
    })) as CallToolResult;
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toMatch(/unavailable or expired/);

    const ok = (await client.callTool({
      name: 'query',
      arguments: { x: 1, z: 2 },
    })) as CallToolResult;
    expect(ok.isError).not.toBe(true);
    expect(JSON.parse(text(ok))).toMatchObject({ x: 1, z: 2 });
  });
});
