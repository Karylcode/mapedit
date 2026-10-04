import { readdir, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerrain, encodeTerrain } from '@mapedit/core';

export async function initProject(directory: string): Promise<string> {
  const root = path.resolve(directory);
  const template = fileURLToPath(new URL('../templates/project/', import.meta.url));
  const cli = fileURLToPath(new URL('./index.js', import.meta.url));
  const inputs = new Map<string, Uint8Array>();
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await readdir(path.join(template, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else {
        const source = await readFile(path.join(template, name), 'utf8');
        const rendered = source
          .replaceAll('{{NODE}}', JSON.stringify(process.execPath).slice(1, -1))
          .replaceAll('{{CLI}}', JSON.stringify(cli).slice(1, -1));
        inputs.set(name, Buffer.from(rendered));
      }
    }
  };
  await walk('');
  const png = encodeTerrain(createTerrain(100, 100));
  inputs.set('maps/village/terrain/height.png', png.height);
  inputs.set('maps/village/terrain/surface.png', png.surface);
  const directories = new Set([root]);
  for (const name of inputs.keys()) {
    let directory = path.dirname(path.join(root, name));
    while (directory !== root) {
      directories.add(directory);
      directory = path.dirname(directory);
    }
  }
  const inspect = async (target: string) => {
    try {
      return await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const checkDirectory = async (directory: string): Promise<void> => {
    const stat = await inspect(directory);
    if (stat?.isSymbolicLink())
      throw new Error(`Init refused to traverse a symbolic link or junction: ${directory}`);
    if (stat && !stat.isDirectory())
      throw new Error(`Init requires a directory but found a file: ${directory}`);
  };
  // Inspect every existing parent before creating anything. lstat also detects dangling
  // links, which access() follows and can mistake for a missing output file.
  for (const directory of [...directories].sort((a, b) => a.length - b.length))
    await checkDirectory(directory);
  for (const name of inputs.keys()) {
    if (await inspect(path.join(root, name)))
      throw new Error(`Init refused to overwrite existing file: ${name}`);
  }
  for (const [name, content] of inputs) {
    const target = path.join(root, name);
    // Recheck ancestry before each write in case an editor changed directories since preflight.
    let directory = path.dirname(target);
    while (directory !== root) {
      await checkDirectory(directory);
      directory = path.dirname(directory);
    }
    await checkDirectory(root);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, { flag: 'wx' });
  }
  return root;
}
