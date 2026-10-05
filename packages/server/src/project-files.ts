import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseProject, type ParsedProject } from '@mapedit/core';
import { containsPath } from './paths.js';

/** Resolve an existing project file, rejecting links that escape the project. */
export async function projectPath(root: string, relative: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(path.resolve(base, relative));
  if (!containsPath(base, target)) {
    throw new Error(`File is outside the project: ${relative}`);
  }
  return target;
}

/** One authoring walker for parsing and history; unrelated outputs are never read. */
export async function readProjectInputs(
  root: string,
  options: { formats?: 'yaml' | 'all'; previous?: ReadonlyMap<string, Buffer> } = {},
): Promise<Map<string, Buffer>> {
  const base = await realpath(root);
  const files = new Map<string, Buffer>();
  const metadata = async (name: string) => {
    try {
      const result = await lstat(path.join(base, name));
      if (result.isSymbolicLink())
        throw new Error(`Symbolic links are not supported in authoring inputs: ${name}`);
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const read = async (name: string) => {
    const content = await readFile(await projectPath(base, name));
    const previous = options.previous?.get(name);
    files.set(name, previous?.equals(content) ? previous : content);
  };
  const walk = async (folder: string): Promise<void> => {
    if (!(await metadata(folder))) return;
    const directory = await projectPath(base, folder);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const child = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink())
        throw new Error(`Symbolic links are not supported in authoring inputs: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (
        entry.isFile() &&
        (options.formats === 'yaml' ? /\.ya?ml$/i : /\.(?:ya?ml|ts|png)$/i).test(entry.name)
      )
        await read(child);
    }
  };
  if (await metadata('project.yaml')) await read('project.yaml');
  await walk('modules');
  await walk('maps');
  return files;
}

export async function readProjectTexts(root: string): Promise<Record<string, string>> {
  return Object.fromEntries(
    [...(await readProjectInputs(root, { formats: 'yaml' }))].map(([file, content]) => [
      file,
      content.toString('utf8'),
    ]),
  );
}

export async function readProject(root: string): Promise<ParsedProject> {
  return parseProject(await readProjectTexts(root));
}
