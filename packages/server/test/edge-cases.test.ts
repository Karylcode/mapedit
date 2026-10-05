import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ServerMessage } from '@mapedit/protocol';
import { createServer, type MapeditServer, type ServerOptions } from '../src/index.js';
import type { DiskState } from '../src/disk-state.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const structure = (id: string, x: number) =>
  `structures:\n  - id: ${id}\n    position: [${x}, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n`;
/** A link to `root`: a junction on Windows, a symbolic link elsewhere. */
async function throughLink(root: string): Promise<string> {
  const link = `${root}-link`;
  await symlink(root, link, 'junction');
  cleanup.push(() => rm(link, { force: true }));
  return link;
}
/**
 * `root` with each name in its short 8.3 form, as GitHub's Windows runners spell their temp
 * folder (C:\Users\RUNNER~1\...). A volume that keeps no short names returns it unchanged.
 */
function shortName(root: string): string {
  return execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${root}") do @echo %~sI`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  }).trim();
}
/** A project whose server gets its root as `spell` writes it. */
async function project(
  options: Partial<ServerOptions> = {},
  spell: (root: string) => string | Promise<string> = (root) => root,
) {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-edges-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: Edge cases\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/a.yaml': structure('a', 10),
    'maps/town/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/town/structures/a.yaml': structure('a', 10),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const given = await spell(root);
  const server = await createServer({ root: given, port: 0, webRoot: null, ...options });
  cleanup.push(() => server.close());
  return { root: given, server, state: server.state as DiskState };
}
async function editor(server: MapeditServer, mapId: string) {
  const socket = new WebSocket(server.url.replace('http:', 'ws:') + '/ws');
  cleanup.push(async () => socket.terminate());
  const received: ServerMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ServerMessage));
  await new Promise<void>((resolve) => socket.once('open', resolve));
  const send = (message: unknown) => socket.send(JSON.stringify(message));
  const find = async <T extends ServerMessage['type']>(
    type: T,
    match: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    from = 0,
  ) => {
    const index = () =>
      received.findIndex(
        (message, at) =>
          at >= from &&
          message.type === type &&
          match(message as Extract<ServerMessage, { type: T }>),
      );
    await expect.poll(index).toBeGreaterThan(-1);
    return received[index()] as Extract<ServerMessage, { type: T }>;
  };
  send({ type: 'hello', protocolVersion: 1, client: 'editor' });
  send({ type: 'openMap', mapId });
  await find('history');
  return { send, find, received };
}

describe('F40 error handling edge cases', () => {
  it('drops a deleted map from the cache and answers it as unknown', async () => {
    const { root, server, state } = await project();
    const town = await editor(server, 'town');
    const village = await editor(server, 'village');
    expect(state.builds.has('town')).toBe(true);
    await rm(join(root, 'maps/town'), { recursive: true });
    await state.flush();
    expect(state.builds.has('town')).toBe(false);
    // Editors with the map open hear that it is gone; others do not.
    expect(await town.find('notice', (message) => message.code === 'unknown_map')).toMatchObject({
      level: 'error',
      mapId: 'town',
    });
    const later = await editor(server, 'village');
    later.send({ type: 'openMap', mapId: 'town' });
    expect(await later.find('notice', (message) => message.code === 'unknown_map')).toMatchObject({
      level: 'error',
    });
    expect(village.received.some((m) => m.type === 'notice' && m.code === 'unknown_map')).toBe(
      false,
    );
    // Later changes no longer rebuild it.
    await writeFile(join(root, 'maps/village/structures/a.yaml'), structure('a', 30));
    await state.flush();
    expect([...state.builds.keys()]).toEqual(['village']);
  });

  it('still broadcasts history and the other scenes when one open map fails to rebuild', async () => {
    const { server, state } = await project();
    const village = await editor(server, 'village');
    const town = await editor(server, 'town');
    const getScene = state.getScene.bind(state);
    vi.spyOn(state, 'getScene').mockImplementation(async (id) => {
      if (id === 'town' && state.entries.length) throw new Error('Town failed to rebuild.');
      return getScene(id);
    });
    const before = village.received.length;
    village.send({
      type: 'applyEdit',
      requestId: 1,
      baseRevision: state.scene.revision,
      edit: { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 },
    });
    expect(await village.find('editResult', (m) => m.requestId === 1)).toMatchObject({ ok: true });
    await village.find('scene', (m) => m.scene.map.id === 'village', before);
    await village.find('history', (m) => m.entries.length === 1, before);
    await town.find('history', (m) => m.entries.length === 1);
    expect(
      await town.find('notice', (m) => m.code === 'file_error' && m.message.includes('Town')),
    ).toBeDefined();
  });

  it('reports file paths relative to the project in request errors', async () => {
    const { root, server, state } = await project();
    const village = await editor(server, 'village');
    const file = join(root, 'maps', 'village', 'structures', 'a.yaml');
    vi.spyOn(state, 'apply').mockRejectedValue(
      new Error(`EBUSY: resource busy or locked, open '${file}'`),
    );
    village.send({
      type: 'applyEdit',
      requestId: 1,
      baseRevision: state.scene.revision,
      edit: { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 },
    });
    const result = await village.find('editResult', (m) => m.requestId === 1);
    expect(result).toMatchObject({
      ok: false,
      failure: 'internal_error',
      reason: "EBUSY: resource busy or locked, open 'maps/village/structures/a.yaml'",
    });
  });

  it('reports file paths relative to the project however its root is spelled', async () => {
    // A link and, on Windows, a short 8.3 name both spell the root differently from the real
    // path the server resolves; GitHub's runners give temp folders such a short name.
    for (const spell of process.platform === 'win32' ? [shortName, throughLink] : [throughLink]) {
      const { root, server, state } = await project({}, spell);
      const village = await editor(server, 'village');
      const file = join(root, 'maps', 'village', 'structures', 'a.yaml');
      vi.spyOn(state, 'apply').mockRejectedValue(
        new Error(`EBUSY: resource busy or locked, open '${file}'`),
      );
      village.send({
        type: 'applyEdit',
        requestId: 1,
        baseRevision: state.scene.revision,
        edit: { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 },
      });
      expect(await village.find('editResult', (m) => m.requestId === 1)).toMatchObject({
        ok: false,
        reason: "EBUSY: resource busy or locked, open 'maps/village/structures/a.yaml'",
      });
      // The file watcher's errors are written the same way.
      (state as unknown as { watcher: EventEmitter }).watcher.emit(
        'error',
        new Error(`EPERM: operation not permitted, watch '${join(root, 'maps')}'`),
      );
      expect(await village.find('notice', (m) => m.code === 'file_error')).toMatchObject({
        message: "EPERM: operation not permitted, watch 'maps'",
      });
    }
  });

  it('finds an editor build made after the server started', async () => {
    const web = await mkdtemp(join(tmpdir(), 'mapedit-late-web-'));
    cleanup.push(() => rm(web, { recursive: true, force: true }));
    const { server } = await project({
      webRoot: [join(web, 'dist')],
      browserPath: join(web, 'no-browser.exe'),
    });
    const client = new Client({ name: 'late-web-test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', server.url)));
    cleanup.push(() => client.close());
    const screenshot = async () =>
      (
        (await client.callTool({
          name: 'screenshot',
          arguments: { map: 'village', views: ['top'], tileSize: 64 },
        })) as CallToolResult
      ).content[0] as { text: string };
    const missing = 'The editor web build is missing; run pnpm build.';
    expect((await screenshot()).text).toBe(missing);
    expect(await (await fetch(`${server.url}/`)).text()).toContain('Build packages/web');
    await mkdir(join(web, 'dist'), { recursive: true });
    await writeFile(join(web, 'dist/index.html'), '<title>Built later</title>');
    expect(await (await fetch(`${server.url}/`)).text()).toContain('Built later');
    // The capture now goes on to the browser, which does not exist here.
    expect((await screenshot()).text).not.toBe(missing);
  });
});

describe('F40 project-relative paths', () => {
  it('rewrites only paths inside the project', async () => {
    const { projectRelativePaths } = await import('../src/paths.js');
    for (const root of ['C:\\work\\proj', '/work/proj']) {
      const separator = root.startsWith('/') ? '/' : '\\';
      const inside = `${root}${separator}maps${separator}village${separator}a.yaml`;
      expect(projectRelativePaths(`EBUSY: open '${inside}'`, root)).toBe(
        "EBUSY: open 'maps/village/a.yaml'",
      );
      expect(projectRelativePaths(`scan '${root}' failed`, root)).toBe("scan '.' failed");
      // A sibling whose name starts with the root's name is another directory.
      const sibling = `${root}2${separator}a.yaml`;
      expect(projectRelativePaths(`open '${sibling}'`, root)).toBe(`open '${sibling}'`);
    }
    expect(projectRelativePaths("open 'C:/work/proj/maps/a.yaml'", 'C:\\work\\proj')).toBe(
      "open 'maps/a.yaml'",
    );
  });

  it('rewrites paths under every spelling of the root, the longest first', async () => {
    const { projectRelativePaths } = await import('../src/paths.js');
    // On macOS /tmp is a link to /private/tmp, so one spelling of the root holds the other.
    expect(
      projectRelativePaths("open '/private/tmp/proj/a.yaml', then '/tmp/proj/b.yaml'", [
        '/tmp/proj',
        '/private/tmp/proj',
      ]),
    ).toBe("open 'a.yaml', then 'b.yaml'");
  });
});
