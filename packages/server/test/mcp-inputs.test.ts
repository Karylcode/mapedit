import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { compatibleSocketTypes, parseProject, type TerrainCommand } from '@mapedit/core';
import type { RenderSpec } from '@mapedit/protocol';
import { createMcpServer } from '../src/mcp.js';
import { createMockServices } from '../src/mock-services.js';
import { createAgentServices } from '../src/services.js';
import { MemoryState } from '../src/state.js';
import { DiskState } from '../src/disk-state.js';
import { buildProject, buildFromParsed } from '../src/build-project.js';
import { ScreenshotService } from '../src/screenshot.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
class Screenshots extends ScreenshotService {
  captures: RenderSpec[] = [];
  override async capture(_map: string, spec: RenderSpec): Promise<Buffer> {
    this.captures.push(spec);
    return Buffer.from('test-image');
  }
}
async function connect() {
  const state = new MemoryState();
  const screenshots = new Screenshots('http://unused');
  const services = createMockServices(state, screenshots);
  const received: unknown[] = [];
  services.terrain = async (_map, command) => {
    received.push(command);
    return { ok: true };
  };
  const server = createMcpServer(services, screenshots);
  const client = new Client({ name: 'inputs-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
    await state.close();
  });
  return { client, received, screenshots, services };
}

it('F15 rejects wrong-kind and malformed Structure refs consistently before tool work', async () => {
  const { client, screenshots } = await connect();
  for (const name of ['screenshot', 'floor_plan', 'free_sockets']) {
    for (const structure of [
      'marker:house',
      'module:house/base',
      'structure:house.edge',
      '',
      'house/other',
    ]) {
      const result = await client.callTool({ name, arguments: { structure } });
      expect(result.isError, `${name}: ${structure}`).toBe(true);
    }
  }
  expect(screenshots.captures).toEqual([]);
});

it('F15 normalizes bare and full Structure refs in all Structure-targeted tools', async () => {
  const { client, screenshots } = await connect();
  for (const name of ['screenshot', 'floor_plan', 'free_sockets']) {
    const bare = await client.callTool({ name, arguments: { structure: 'house' } });
    const full = await client.callTool({ name, arguments: { structure: 'structure:house' } });
    expect(bare.isError, JSON.stringify(bare)).not.toBe(true);
    expect(full.content).toEqual(bare.content);
  }
  expect(screenshots.captures).toHaveLength(2);
  expect(screenshots.captures[1]).toEqual(screenshots.captures[0]);
  expect(screenshots.captures[0]?.highlight).toEqual(['structure:house']);
});

it('F15 passes every valid TerrainCommand operation through the SDK boundary unchanged', async () => {
  const { client, received } = await connect();
  const circle = { kind: 'circle', center: [10, 10], radius: 2 } as const;
  const commands: TerrainCommand[] = [
    { operation: 'raise', amount: 0.5, region: { ...circle, center: [...circle.center] } },
    { operation: 'lower', amount: 1, region: { kind: 'rectangle', min: [10, 10], max: [20, 20] } },
    { operation: 'flatten', region: { kind: 'circle', center: [10, 10], radius: 2 } },
    { operation: 'flatten', height: 2, region: { kind: 'circle', center: [10, 10], radius: 2 } },
    {
      operation: 'set_height',
      height: -2,
      region: { kind: 'circle', center: [10, 10], radius: 2 },
    },
    { operation: 'mountain', height: 4.5, region: { kind: 'circle', center: [10, 10], radius: 2 } },
    {
      operation: 'paint',
      surface: 'gravel',
      region: {
        kind: 'path',
        points: [
          [10, 10],
          [20, 20],
        ],
        width: 3,
      },
    },
  ];
  for (const command of commands) {
    const result = await client.callTool({ name: 'terrain', arguments: { command } });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
  }
  expect(received).toEqual(commands);
});

it('F15 rejects invalid terrain parameters before reaching a mutation service', async () => {
  const { client, received } = await connect();
  const region = { kind: 'circle', center: [10, 10], radius: 2 };
  for (const command of [
    { operation: 'raise', amount: 0.25, region },
    { operation: 'lower', amount: -0.5, region },
    { operation: 'set_height', region },
    { operation: 'set_height', height: 16384, region },
    { operation: 'flatten', height: 'high', region },
    { operation: 'paint', surface: 'lava', region },
    { operation: 'mountain', height: 3, region: { ...region, radius: 0 } },
    { operation: 'raise', amount: 1, region: { kind: 'path', points: [[1, 1]], width: 2 } },
  ])
    expect((await client.callTool({ name: 'terrain', arguments: { command } })).isError).toBe(true);
  expect(received).toEqual([]);
});

it('F15 real and mock services use core Socket compatibility including reverse declarations', async () => {
  const { services, screenshots } = await connect();
  const defaults = parseProject({}).project.socketTypes;
  for (const type of Object.keys(defaults))
    expect(services.compatibleSocketTypes(type)).toEqual(compatibleSocketTypes(defaults, type));
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-socket-services-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'maps/site'), { recursive: true });
  await writeFile(
    path.join(root, 'project.yaml'),
    'name: Rules\nsocketTypes:\n  plug: {compatibleWith: []}\n  slot: {compatibleWith: [plug]}\n',
  );
  await writeFile(path.join(root, 'maps/site/map.yaml'), 'size: {x: 100, z: 100}\n');
  const state = await DiskState.create(root, {
    build: (id, revision) => buildProject(root, id, revision),
    preview: buildFromParsed,
  });
  cleanup.push(() => state.close());
  const real = createAgentServices(state, screenshots);
  expect(real.compatibleSocketTypes('plug')).toEqual(['slot']);
  expect(real.compatibleSocketTypes('slot')).toEqual(['plug']);
  expect(real.compatibleSocketTypes('absent')).toEqual([]);
});
