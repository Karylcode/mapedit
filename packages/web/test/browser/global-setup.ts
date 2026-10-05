import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

/**
 * A folder for the one production build of packages/web that the browser tests
 * share; `buildWeb` fills it the first time a test asks. Runs that need no
 * browser test never build anything.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const folder = await mkdtemp(join(tmpdir(), 'mapedit-web-build-'));
  project.provide('webBuild', folder);
  return () => rm(folder, { recursive: true, force: true });
}
