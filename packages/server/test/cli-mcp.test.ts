import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/index.js';
import { discoverServer, registerServer } from '../../cli/src/discovery.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-cli-mcp-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'maps/village'), { recursive: true });
  await writeFile(join(root, 'project.yaml'), 'name: CLI project\n');
  await writeFile(join(root, 'maps/village/map.yaml'), 'name: Village\nsize: {x: 100, z: 100}\n');
  return root;
}
async function client(root: string) {
  const connection = new Client({ name: 'cli-discovery-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../../cli/dist/index.js', import.meta.url)), 'mcp'],
    cwd: root,
    stderr: 'pipe',
  });
  let diagnostics = '';
  transport.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  try {
    await connection.connect(transport);
  } catch (error) {
    throw new Error(`${String(error)} ${diagnostics}`, { cause: error });
  }
  cleanup.push(() => connection.close());
  return connection;
}

describe('CLI MCP discovery and process lifecycle', () => {
  it('auto-starts a backend, serves SDK requests and removes registry on stdin close', async () => {
    const root = await project();
    const connection = await client(root);
    expect((await connection.listTools()).tools).toHaveLength(10);
    const result = await connection.callTool({ name: 'check', arguments: {} });
    expect(result.isError).not.toBe(true);
    const record = JSON.parse(await readFile(join(root, '.mapedit/server.json'), 'utf8')) as {
      pid: number;
      url: string;
      instance: string;
    };
    expect(record.pid).not.toBe(process.pid);
    expect(record.instance).toBeTruthy();
    expect(await discoverServer(root)).toBe(record.url);
    await connection.close();
    await expect
      .poll(
        async () =>
          readFile(join(root, '.mapedit/server.json')).then(
            () => true,
            () => false,
          ),
        { timeout: 5000 },
      )
      .toBe(false);
    expect(
      await fetch(record.url + '/api/project').then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(() => process.kill(record.pid, 0)).toThrow();
  });
  it('attaches to an existing backend and leaves its process and registry alive', async () => {
    const root = await project();
    const server = await createServer({ root, port: 0 });
    cleanup.push(() => server.close());
    const unregister = await registerServer(root, server.url);
    cleanup.push(unregister);
    const before = await readFile(join(root, '.mapedit/server.json'), 'utf8');
    const connection = await client(root);
    await connection.callTool({
      name: 'terrain',
      arguments: {
        command: {
          operation: 'raise',
          amount: 0.5,
          region: { kind: 'circle', center: [50, 50], radius: 2 },
        },
      },
    });
    expect(server.state.entries).toHaveLength(1);
    expect(await readFile(join(root, '.mapedit/server.json'), 'utf8')).toBe(before);
    await connection.close();
    expect((await fetch(server.url + '/api/project')).ok).toBe(true);
    expect(await discoverServer(root)).toBe(server.url);
  });
  it('rejects stale identities and a registry redirected to another project', async () => {
    const root = await project(),
      other = await project();
    const first = await createServer({ root, port: 0 }),
      second = await createServer({ root: other, port: 0 });
    cleanup.push(
      () => first.close(),
      () => second.close(),
    );
    const unregister = await registerServer(root, first.url);
    cleanup.push(unregister);
    const registry = join(root, '.mapedit/server.json');
    const record = JSON.parse(await readFile(registry, 'utf8')) as Record<string, unknown>;
    await writeFile(registry, JSON.stringify({ ...record, instance: 'stale-instance' }));
    expect(await discoverServer(root)).toBeUndefined();
    const otherResponse = await fetch(second.url + '/api/project');
    await writeFile(
      registry,
      JSON.stringify({
        ...record,
        url: second.url,
        instance: otherResponse.headers.get('X-Mapedit-Instance'),
      }),
    );
    expect(await discoverServer(root)).toBeUndefined();
    await expect(registerServer(root, second.url)).rejects.toThrow('another project');
    const connection = await client(root);
    const fresh = JSON.parse(await readFile(registry, 'utf8')) as { url: string; pid: number };
    expect(fresh.url).not.toBe(second.url);
    expect(fresh.url).not.toBe(first.url);
    await connection.close();
    expect((await fetch(second.url + '/api/project')).ok).toBe(true);
  });
  it('rejects an authoring root directory junction before starting a watcher', async () => {
    const root = await project(),
      outside = await project();
    await symlink(
      outside,
      join(root, 'modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(createServer({ root, port: 0 })).rejects.toThrow('Symbolic links');
    expect(await readFile(join(outside, 'project.yaml'), 'utf8')).toBe('name: CLI project\n');
  });
});
