import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProject } from '@mapedit/core';
import type { ProjectEntry } from '@mapedit/protocol';

/**
 * The projects in a folder: every subfolder with a project.yaml, by folder name.
 * Folders starting with a dot are skipped. The name comes from project.yaml, or
 * is the folder name when the file cannot be read.
 */
export async function listProjects(directory: string): Promise<ProjectEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const projects = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(async (entry): Promise<ProjectEntry | undefined> => {
        const text = await readFile(join(directory, entry.name, 'project.yaml'), 'utf8').catch(
          () => undefined,
        );
        if (text === undefined) return undefined;
        const parsed = parseProject({ 'project.yaml': text });
        const readable = !parsed.fileErrors.some((error) => error.file === 'project.yaml');
        return { id: entry.name, name: readable ? parsed.project.name : entry.name };
      }),
  );
  return projects
    .filter((project): project is ProjectEntry => project !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
