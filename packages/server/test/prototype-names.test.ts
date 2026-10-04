import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ServerMessage } from '@mapedit/protocol';
import { compileMap, parseProject } from '@mapedit/core';
import { createServer } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
const files: Record<string, string> = {
  'project.yaml': 'name: Prototype names\n',
  'modules/block/module.yaml': 'size: [2, 2, 2]\n',
  'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
  'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
  'maps/village/structures/a.yaml':
    'structures:\n  - id: a\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n',
};

async function realServer() {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-proto-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0 });
  cleanup.push(() => server.close());
  return server;
}

describe('F29 Object.prototype names are never existing objects', () => {
  it('answers previews and edits for prototype names as unknown objects', async () => {
    const server = await realServer();
    const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
    cleanup.push(async () => socket.terminate());
    const messages: ServerMessage[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    const next = async <T extends ServerMessage['type']>(type: T, requestId?: number) => {
      const matches = (message: ServerMessage) =>
        message.type === type &&
        (requestId === undefined || ('requestId' in message && message.requestId === requestId));
      await expect.poll(() => messages.some(matches)).toBe(true);
      return messages.splice(messages.findIndex(matches), 1)[0] as Extract<
        ServerMessage,
        { type: T }
      >;
    };
    const send = (message: unknown) => socket.send(JSON.stringify(message));
    send({ type: 'hello', protocolVersion: 1, client: 'editor' });
    await next('welcome');
    send({ type: 'openMap', mapId: 'village' });
    await next('scene');
    let requestId = 0;
    for (const ref of names)
      for (const edit of [
        { kind: 'delete', ref },
        { kind: 'move', ref, position: [20, 0, 20], rotation: 0 },
      ]) {
        const preview = ++requestId;
        send({ type: 'previewEdit', requestId: preview, edit });
        expect(await next('previewResult', preview), `${edit.kind} ${ref}`).toMatchObject({
          ok: false,
          failure: 'unknown_object',
        });
        const apply = ++requestId;
        send({ type: 'applyEdit', requestId: apply, baseRevision: 0, edit });
        expect(await next('editResult', apply), `${edit.kind} ${ref}`).toMatchObject({
          ok: false,
          failure: 'unknown_object',
        });
      }
    expect(server.state.entries).toEqual([]);
  });

  it('does not treat prototype names as Modules in MCP build_module', async () => {
    const server = await realServer();
    const client = new Client({ name: 'prototype-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    for (const module of names) {
      const result = (await client.callTool({
        name: 'build_module',
        arguments: { module },
      })) as CallToolResult;
      expect(result.isError, module).toBe(true);
      expect((result.content[0] as { text: string }).text).toBe(
        `Module '${module}' does not exist.`,
      );
    }
  });

  it('compiles prototype map and Module names as missing', () => {
    const parsed = parseProject({
      ...files,
      'maps/village/structures/a.yaml':
        'structures:\n  - id: a\n    position: [10, 10]\n    modules:\n      - {id: base, module: constructor, at: [0, 0, 0]}\n',
    });
    for (const map of names) {
      const compiled = compileMap(parsed, map);
      expect(compiled.scene.fileErrors.map((error) => error.message)).toContain(
        `Map "${map}" does not exist. Choose a map listed in project information.`,
      );
    }
    const village = compileMap(parsed, 'village');
    expect(village.scene.violations).toContainEqual(
      expect.objectContaining({
        kind: 'missing_reference',
        params: expect.objectContaining({ reason: 'unknown_module', reference: 'constructor' }),
      }),
    );
    expect(Object.getPrototypeOf(village.sourceRefs)).toBeNull();
  });
});
