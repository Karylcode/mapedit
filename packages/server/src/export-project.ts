import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { exportMapGlb } from '@mapedit/core';
import { buildProject, type BuiltProject } from './build-project.js';
import { loadBuiltinTextures } from './model-runner.js';

export async function exportBuiltProject(built: BuiltProject, out: string): Promise<string> {
  const glb = await exportMapGlb({
    compilation: built.compilation,
    models: built.geometries,
    terrain: built.terrain,
    generated: built.generated,
    textures: await loadBuiltinTextures(),
  });
  const folder = path.resolve(built.root, out);
  await mkdir(folder, { recursive: true });
  const filename = path.join(folder, `${built.scene.map.id}.glb`);
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, glb);
  await rename(temporary, filename);
  return filename;
}

export async function exportProject(
  root: string,
  mapId: string | undefined,
  out: string,
): Promise<string> {
  return exportBuiltProject(await buildProject(root, mapId), out);
}
