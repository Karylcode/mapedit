import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { NoticeCode } from '@mapedit/protocol';
import { createServer } from '../src/index.js';
import { MemoryState, type StateStore } from '../src/state.js';
import { createMockServices } from '../src/mock-services.js';
import type { AgentServices } from '../src/mcp.js';
import type { ScreenshotService } from '../src/screenshot.js';
import { boxGlb } from '../src/mock.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function opaqueState(capability = false) {
  const memory = new MemoryState();
  const counts = { factory: 0, trigger: 0, getScene: 0 };
  const state: StateStore & {
    createAgentServices(screenshots: ScreenshotService): AgentServices;
    triggerMockNotice?: (code: NoticeCode) => Promise<void>;
  } = {
    project: memory.project,
    get scene() {
      return memory.scene;
    },
    get entries() {
      return memory.entries;
    },
    get cursor() {
      return memory.cursor;
    },
    flush: () => memory.flush(),
    async openMap() {
      throw new Error('Reading a scene must use getScene.');
    },
    async getScene(id) {
      counts.getScene++;
      if (id && id !== memory.scene.map.id) throw new Error(`Unknown map ${id}`);
      return memory.scene;
    },
    asset: (path) => (path === '/assets/opaque/custom.glb' ? boxGlb() : undefined),
    createAgentServices(screenshots) {
      counts.factory++;
      return {
        ...createMockServices(memory, screenshots),
        async query() {
          return { suppliedByState: true };
        },
      };
    },
    ...(capability
      ? {
          async triggerMockNotice() {
            counts.trigger++;
          },
        }
      : {}),
    preview: (edit, requestId) => memory.preview(edit, requestId),
    apply: (edit, revision) => memory.apply(edit, revision),
    travel: (direction) => memory.travel(direction),
    on(event, listener) {
      memory.on(event, listener);
      return this;
    },
    close: () => memory.close(),
  };
  return { state, counts };
}

describe('F16 StateStore contract', () => {
  it('uses an opaque state factory and its scene/assets without inspecting its class', async () => {
    const { state, counts } = opaqueState();
    const server = await createServer({ port: 0, state });
    cleanup.push(() => server.close());
    const client = new Client({ name: 'opaque-state-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    const query = await client.callTool({ name: 'query', arguments: { x: 0, z: 0 } });
    expect(query.isError).not.toBe(true);
    expect(JSON.parse((query.content as Array<{ text: string }>)[0]!.text)).toEqual({
      suppliedByState: true,
    });
    expect(counts.factory).toBe(1);
    expect((await fetch(`${server.url}/api/scene?map=village`)).status).toBe(200);
    expect(counts.getScene).toBeGreaterThan(0);
    expect((await fetch(`${server.url}/api/scene?map=unknown`)).status).toBe(400);
    const asset = await fetch(`${server.url}/assets/opaque/custom.glb`);
    expect(asset.status).toBe(200);
    expect(Buffer.from(await asset.arrayBuffer()).readUInt32LE(0)).toBe(0x46546c67);
    expect((await fetch(`${server.url}/assets/opaque/missing.glb`)).status).toBe(404);
  });

  it('uses mock capability only when mock mode is enabled and obtains all assets from the state', async () => {
    for (const [mock, capability, status] of [
      [true, true, 200],
      [false, true, 404],
      [true, false, 404],
    ] as const) {
      const { state, counts } = opaqueState(capability);
      const server = await createServer({ port: 0, mock, state });
      cleanup.push(() => server.close());
      const response = await fetch(`${server.url}/api/mock/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice: 'agent_changed' }),
      });
      expect(response.status).toBe(status);
      expect(counts.trigger).toBe(status === 200 ? 1 : 0);
      expect((await fetch(`${server.url}/assets/mock/block.glb`)).status).toBe(404);
    }
  });

  it('implements scene lookup and assets directly in MemoryState', async () => {
    const state: StateStore = new MemoryState();
    cleanup.push(() => state.close());
    expect(typeof state.getScene).toBe('function');
    expect(typeof state.asset).toBe('function');
    expect(await state.getScene!('village')).toBe(state.scene);
    await expect(state.getScene!('unknown')).rejects.toThrow();
    expect(state.scene.map.id).toBe('village');
    expect(state.asset!('/assets/mock/block.glb')?.length).toBeGreaterThan(0);
    expect(state.asset!('/assets/mock/missing.glb')).toBeUndefined();
  });
});
