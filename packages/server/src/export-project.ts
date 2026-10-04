import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { exportMapGlb } from '@mapedit/core';
import { buildProjects, type BuiltProject } from './build-project.js';
import { loadBuiltinTextures } from './model-runner.js';

async function renderProject(built: BuiltProject): Promise<Uint8Array> {
  return exportMapGlb({
    compilation: built.compilation,
    models: built.geometries,
    terrain: built.terrain,
    generated: built.generated,
    textures: await loadBuiltinTextures(),
  });
}

async function writeExport(built: BuiltProject, out: string, glb: Uint8Array): Promise<string> {
  const folder = path.resolve(built.root, out);
  await mkdir(folder, { recursive: true });
  const filename = path.join(folder, `${built.scene.map.id}.glb`);
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, glb);
  await rename(temporary, filename);
  return filename;
}

export async function exportBuiltProject(built: BuiltProject, out: string): Promise<string> {
  return writeExport(built, out, await renderProject(built));
}

export async function exportProject(
  root: string,
  mapId: string | undefined,
  out: string,
): Promise<string[]> {
  const built = await buildProjects(root, mapId);
  const invalid = built.filter(({ scene }) => scene.violations.length || scene.fileErrors.length);
  if (invalid.length)
    throw new Error(
      `Export refused for maps: ${invalid.map(({ scene }) => scene.map.id).join(', ')}. ${[
        ...new Set(
          invalid.flatMap(({ scene }) =>
            scene.fileErrors.map((error) => `${error.file}:${error.line ?? 1}: ${error.message}`),
          ),
        ),
      ].join(' ')} Run check and fix all violations and file errors first.`,
    );
  // Revalidate and prepare every GLB before creating or replacing any output file.
  const prepared: { built: BuiltProject; glb: Uint8Array }[] = [];
  const failures: string[] = [];
  for (const project of built) {
    try {
      prepared.push({ built: project, glb: await renderProject(project) });
    } catch (error) {
      failures.push(
        `${project.scene.map.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (failures.length) throw new Error(`Export refused for maps: ${failures.join('; ')}`);
  const files: string[] = [];
  for (const item of prepared) files.push(await writeExport(item.built, out, item.glb));
  return files;
}
