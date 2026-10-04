import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initProject } from '../src/init.js';

const roots: string[] = [];
async function temporary(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-init-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('checks every collision before writing and preserves unrelated files', async () => {
  const root = await temporary();
  await writeFile(path.join(root, 'notes.txt'), 'keep this');
  await mkdir(path.join(root, 'maps/village/terrain'), { recursive: true });
  await writeFile(path.join(root, 'maps/village/terrain/surface.png'), 'existing image');
  await expect(initProject(root)).rejects.toThrow('overwrite');
  expect(await readdir(root)).toEqual(['maps', 'notes.txt']);
  expect(await readFile(path.join(root, 'maps/village/terrain/surface.png'), 'utf8')).toBe(
    'existing image',
  );
  expect(await readFile(path.join(root, 'notes.txt'), 'utf8')).toBe('keep this');
});

it('rejects a regular file used as a planned directory before writing anything', async () => {
  const root = await temporary();
  await writeFile(path.join(root, 'maps'), 'not a directory');
  await expect(initProject(root)).rejects.toThrow('requires a directory');
  expect(await readdir(root)).toEqual(['maps']);
});

it('rejects an existing file as the project root', async () => {
  const root = await temporary();
  const target = path.join(root, 'project');
  await writeFile(target, 'keep');
  await expect(initProject(target)).rejects.toThrow('requires a directory');
  expect(await readFile(target, 'utf8')).toBe('keep');
});

it('does not initialize through a directory junction outside the selected project', async () => {
  const root = await temporary(),
    outside = await temporary();
  await symlink(
    outside,
    path.join(root, 'modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(initProject(root)).rejects.toThrow('symbolic link or junction');
  expect(await readdir(outside)).toEqual([]);
  expect(await readdir(root)).toEqual(['modules']);
});

it('initializes a new nested directory and renders usable direct Node MCP configs', async () => {
  const parent = await temporary(),
    root = path.join(parent, 'new', 'project');
  await initProject(root);
  const config = JSON.parse(await readFile(path.join(root, '.mcp.stdio.json'), 'utf8'));
  expect(config.mcpServers.mapedit.command).toBe(process.execPath);
  expect(config.mcpServers.mapedit.args.at(-1)).toBe('mcp');
  const toml = await readFile(path.join(root, '.codex/config.stdio.toml'), 'utf8');
  expect(toml).not.toContain('{{');
  expect(toml).toContain(`command = ${JSON.stringify(process.execPath)}`);
  expect([
    ...(await readFile(path.join(root, 'maps/village/terrain/height.png'))).subarray(0, 8),
  ]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});
