import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const temporary: string[] = [];
const running: ChildProcess[] = [];
afterEach(async () => {
  for (const child of running.splice(0)) await stop(child);
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function projectsFolder(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'mapedit-cli-projects-'));
  temporary.push(directory);
  for (const [id, name] of [
    ['bridge', 'Bridge'],
    ['tower', 'Tower'],
  ]) {
    await mkdir(path.join(directory, id, 'maps', 'main'), { recursive: true });
    await writeFile(path.join(directory, id, 'project.yaml'), `name: ${name}\n`);
    await writeFile(
      path.join(directory, id, 'maps', 'main', 'map.yaml'),
      'id: main\nsize: {x: 100, z: 100}\n',
    );
  }
  return directory;
}

/** Start `mapedit dev` on a free port; resolves with its URL, or rejects with its error output. */
function dev(...args: string[]): Promise<{ child: ChildProcess; url: string }> {
  const child = spawn(process.execPath, [cli, 'dev', '--port', '0', ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  running.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    child.stderr!.on('data', (chunk: Buffer) => {
      output += String(chunk);
      const url = /listening at (http:\/\/\S+)/.exec(output)?.[1];
      if (url) resolve({ child, url });
    });
    child.once('exit', () => reject(new Error(output)));
  });
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

const openProject = async (url: string) =>
  ((await (await fetch(new URL('/api/project', url))).json()) as { id: string }).id;

it('dev --projects opens the first project, then the one open last, or the one asked for', async () => {
  const directory = await projectsFolder();
  const first = await dev('--projects', directory);
  expect(await openProject(first.url)).toBe('bridge');
  expect((await readFile(path.join(directory, '.last-project'), 'utf8')).trim()).toBe('bridge');
  // The open project registers its server, so `mapedit mcp` run there finds it.
  expect(existsSync(path.join(directory, 'bridge', '.mapedit', 'server.json'))).toBe(true);

  // The editor switches projects: the server stays, and the new project registers itself.
  const socket = new WebSocket(first.url.replace('http', 'ws') + '/ws');
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  const closed = new Promise((resolve) =>
    socket.addEventListener('close', resolve, { once: true }),
  );
  socket.send(JSON.stringify({ type: 'hello', protocolVersion: 1, client: 'editor' }));
  socket.send(JSON.stringify({ type: 'openProject', projectId: 'tower' }));
  await closed;
  expect(await openProject(first.url)).toBe('tower');
  for (
    let i = 0;
    i < 50 && !existsSync(path.join(directory, 'tower', '.mapedit', 'server.json'));
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  expect(existsSync(path.join(directory, 'tower', '.mapedit', 'server.json'))).toBe(true);
  expect(existsSync(path.join(directory, 'bridge', '.mapedit', 'server.json'))).toBe(false);
  expect((await readFile(path.join(directory, '.last-project'), 'utf8')).trim()).toBe('tower');
  await stop(first.child);

  await writeFile(path.join(directory, '.last-project'), 'tower\n');
  const again = await dev('--projects', directory);
  expect(await openProject(again.url)).toBe('tower');
  await stop(again.child);

  const asked = await dev('--projects', directory, '--project', 'bridge');
  expect(await openProject(asked.url)).toBe('bridge');
  await stop(asked.child);

  await expect(dev('--projects', directory, '--project', 'castle')).rejects.toThrow(
    /castle is not a project folder/,
  );
  const empty = await mkdtemp(path.join(tmpdir(), 'mapedit-cli-empty-'));
  temporary.push(empty);
  await expect(dev('--projects', empty)).rejects.toThrow(/has no projects/);
});
