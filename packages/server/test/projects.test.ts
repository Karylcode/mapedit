import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { WebSocket } from 'ws';
import type { ProjectInfo, ServerMessage } from '@mapedit/protocol';
import { createServer, listProjects, projectIdentity } from '../src/index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, data] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), data);
  }
}

/** A folder of projects: two real ones, a folder without project.yaml and a hidden one. */
async function projectsFolder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mapedit-projects-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const project = (name: string, map: string) => ({
    'project.yaml': `name: ${name}\n`,
    [`maps/${map}/map.yaml`]: `id: ${map}\nname: ${name} map\nsize: {x: 100, z: 100}\n`,
  });
  await write(join(directory, 'castle'), project('Castle', 'keep'));
  await write(join(directory, 'abbey'), project('Abbey', 'cloister'));
  await write(join(directory, 'notes'), { 'readme.txt': 'not a project\n' });
  await write(join(directory, '.hidden'), project('Hidden', 'secret'));
  return directory;
}

/** A socket that collects messages; `next` waits for one of a type. */
function connect(url: string) {
  const socket = new WebSocket(url.replace('http', 'ws') + '/ws');
  const received: ServerMessage[] = [];
  const waiting: Array<() => void> = [];
  socket.on('message', (data) => {
    received.push(JSON.parse(String(data)) as ServerMessage);
    for (const wake of waiting.splice(0)) wake();
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  const next = async <T extends ServerMessage['type']>(type: T) => {
    for (;;) {
      const index = received.findIndex((message) => message.type === type);
      if (index >= 0) return received.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>;
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
  };
  const open = new Promise<void>((resolve) => socket.once('open', () => resolve()));
  const send = async (message: unknown) => {
    await open;
    socket.send(JSON.stringify(message));
  };
  cleanup.push(async () => socket.close());
  return { socket, next, send, closed };
}

describe('folder of projects', () => {
  it('lists project folders by folder name with their project.yaml names', async () => {
    const directory = await projectsFolder();
    expect(await listProjects(directory)).toEqual([
      { id: 'abbey', name: 'Abbey' },
      { id: 'castle', name: 'Castle' },
    ]);
    expect(await listProjects(join(directory, 'missing'))).toEqual([]);
  });

  it('switches the whole server to another project when the editor asks (flow 11)', async () => {
    const directory = await projectsFolder();
    const opened: string[] = [];
    const closed: string[] = [];
    const server = await createServer({
      port: 0,
      root: join(directory, 'castle'),
      webRoot: null,
      projects: {
        directory,
        async opened(root, url) {
          expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
          opened.push(basename(root));
          return async () => void closed.push(basename(root));
        },
      },
    });
    cleanup.push(() => server.close());
    expect(opened).toEqual(['castle']);

    const first = connect(server.url);
    await first.send({ type: 'hello', protocolVersion: 1, client: 'editor' });
    const welcome = await first.next('welcome');
    expect(welcome.project).toMatchObject({
      name: 'Castle',
      id: 'castle',
      maps: [{ id: 'keep', name: 'Castle map' }],
      projects: [
        { id: 'abbey', name: 'Abbey' },
        { id: 'castle', name: 'Castle' },
      ],
    });

    // Unknown projects and the open one are ignored; the connection stays.
    await first.send({ type: 'openProject', projectId: 'notes' });
    await first.send({ type: 'openProject', projectId: 'castle' });
    await first.send({ type: 'openMap', mapId: 'keep' });
    expect((await first.next('scene')).scene.map.id).toBe('keep');

    await first.send({ type: 'openProject', projectId: 'abbey' });
    await first.closed;

    // A connection made during the switch is answered once the new project is open.
    const second = connect(server.url);
    await second.send({ type: 'hello', protocolVersion: 1, client: 'editor' });
    expect((await second.next('welcome')).project).toMatchObject({ name: 'Abbey', id: 'abbey' });
    expect(opened).toEqual(['castle', 'abbey']);
    expect(closed).toEqual(['castle']);
    expect(basename(server.root)).toBe('abbey');
    await second.send({ type: 'openMap', mapId: 'cloister' });
    expect((await second.next('scene')).scene.map.id).toBe('cloister');

    const head = await fetch(new URL('/api/project', server.url), { method: 'HEAD' });
    expect(head.headers.get('X-Mapedit-Project')).toBe(projectIdentity(server.root));
    const info = (await (await fetch(new URL('/api/project', server.url))).json()) as ProjectInfo;
    expect(info.id).toBe('abbey');
  });

  it('opens a project whose project.yaml has errors, listed by its folder name', async () => {
    const directory = await projectsFolder();
    await write(join(directory, 'abbey'), { 'project.yaml': 'name: [unterminated\n' });
    expect(await listProjects(directory)).toContainEqual({ id: 'abbey', name: 'abbey' });
    const server = await createServer({
      port: 0,
      root: join(directory, 'castle'),
      webRoot: null,
      projects: { directory },
    });
    cleanup.push(() => server.close());
    const socket = connect(server.url);
    await socket.send({ type: 'hello', protocolVersion: 1, client: 'editor' });
    await socket.next('welcome');
    await socket.send({ type: 'openProject', projectId: 'abbey' });
    await socket.closed;
    const again = connect(server.url);
    await again.send({ type: 'hello', protocolVersion: 1, client: 'editor' });
    expect((await again.next('welcome')).project.id).toBe('abbey');
    await again.send({ type: 'openMap', mapId: 'cloister' });
    const { scene } = await again.next('scene');
    expect(scene.fileErrors).toContainEqual(expect.objectContaining({ file: 'project.yaml' }));
  });
});
