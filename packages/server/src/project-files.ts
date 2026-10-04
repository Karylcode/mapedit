import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseProject, type ParsedProject } from '@mapedit/core';

/** Resolve an existing project file, rejecting links that escape the project. */
export async function projectPath(root: string, relative: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(path.resolve(base, relative));
  const inside = path.relative(base, target);
  if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
    throw new Error(`File is outside the project: ${relative}`);
  }
  return target;
}

/** Only authoring inputs are read; outputs, dependencies, and arbitrary files are excluded. */
export async function readProjectTexts(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const read = async (relative: string) => {
    files[relative] = await readFile(await projectPath(root, relative), 'utf8');
  };
  const walk = async (relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not project inputs: ${child}`);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) await read(child);
    }
  };
  try {
    await read('project.yaml');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await walk('modules');
  await walk('maps');
  return files;
}

export async function readProject(root: string): Promise<ParsedProject> {
  return parseProject(await readProjectTexts(root));
}
