import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  compileMap,
  createTerrain,
  decodeTerrain,
  terrainHeightAt,
  terrainTriangles,
  terrainChunks,
  terrainChunkGlb,
  checkGeometry,
  modelToGlb,
  compareText,
  type ParsedProject,
  type Compilation,
  type TerrainData,
  type ModelGeometry,
} from '@mapedit/core';
import { projectPath, readProject } from './project-files.js';
import { runModel, loadBuiltinTextures } from './model-runner.js';

export interface BuiltProject {
  root: string;
  parsed: ParsedProject;
  compilation: Compilation;
  scene: Compilation['scene'];
  terrain: TerrainData;
  geometries: Map<string, ModelGeometry>;
  generated: { owner: string; geometry: ModelGeometry }[];
  assets: Map<string, Uint8Array>;
  moduleUrls: Map<string, string>;
  heightAt(x: number, z: number): number;
}
const hash = (...values: (string | Uint8Array)[]) => {
  const digest = createHash('sha256');
  for (const value of values) digest.update(value);
  return digest.digest('hex').slice(0, 24);
};
const models = new Map<string, Promise<{ geometry: ModelGeometry; glb: Uint8Array }>>();
const terrains = new Map<
  string,
  Promise<{
    terrain: TerrainData;
    assets: Map<string, Uint8Array>;
    chunks: Compilation['scene']['terrain']['chunks'];
  }>
>();
let activeModelBuilds = 0;
const modelWaiters: (() => void)[] = [];
async function withModelSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeModelBuilds >= 4) await new Promise<void>((release) => modelWaiters.push(release));
  else activeModelBuilds++;
  try {
    return await operation();
  } finally {
    const next = modelWaiters.shift();
    if (next) next();
    else activeModelBuilds--;
  }
}

/** Pure recompilation reuses expensive model builds and terrain chunk assets during dragging. */
export async function buildFromParsed(
  parsed: ParsedProject,
  mapId: string | undefined,
  revision: number,
  cached: BuiltProject,
): Promise<BuiltProject> {
  const compilation = compileMap(parsed, mapId, {
    revision,
    terrainHeight: (x, z) => terrainHeightAt(cached.terrain, x, z),
    moduleUrl: (id) => cached.moduleUrls.get(id) ?? '',
    terrain: { ...cached.scene.terrain, revision },
  });
  // Model and PNG diagnostics stay visible until a full input refresh replaces the cache.
  for (const error of cached.scene.fileErrors) {
    if (
      !compilation.scene.fileErrors.some(
        (item) => item.file === error.file && item.message === error.message,
      )
    )
      compilation.scene.fileErrors.push(error);
  }
  const checked = await checkGeometry(compilation, cached.geometries, {
    heightAt: (x, z) => terrainHeightAt(cached.terrain, x, z),
    trianglesInBounds: (bounds) => terrainTriangles(cached.terrain, bounds),
  });
  compilation.scene.violations.push(...checked.violations);
  compilation.scene.fileErrors.sort(
    (a, b) =>
      a.file.localeCompare(b.file, 'en') ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.message.localeCompare(b.message, 'en'),
  );
  const assets = new Map(
    [...cached.assets].filter(([url]) => !url.startsWith('/assets/generated/')),
  );
  const textures = await loadBuiltinTextures();
  for (const item of checked.generated) {
    const glb = await modelToGlb(item.geometry, {
      name: item.owner,
      textures,
      extras: { mapedit: { kind: 'foundation', owner: item.owner, collider: { type: 'mesh' } } },
    });
    const url = `/assets/generated/${hash(glb)}.glb`;
    assets.set(url, glb);
    compilation.scene.generated.push({ owner: item.owner, url });
  }
  return {
    ...cached,
    parsed,
    compilation,
    scene: compilation.scene,
    assets,
    generated: checked.generated,
  };
}

/** Read all latest authoring files before answering CLI/MCP/editor requests. */
export async function buildProject(
  root: string,
  mapId?: string,
  revision = 1,
): Promise<BuiltProject> {
  return buildParsedProject(root, await readProject(root), mapId, revision);
}

/** Check all maps from the same authoring snapshot; retain diagnostics for an empty project. */
export async function buildProjects(
  root: string,
  mapId?: string,
  revision = 1,
): Promise<BuiltProject[]> {
  const parsed = await readProject(root);
  const ids =
    mapId === undefined ? parsed.info.maps.map((map) => map.id).sort(compareText) : [mapId];
  if (ids.length === 0) return [await buildParsedProject(root, parsed, undefined, revision)];
  const built: BuiltProject[] = [];
  for (const id of ids) built.push(await buildParsedProject(root, parsed, id, revision));
  return built;
}

async function buildParsedProject(
  root: string,
  parsed: ParsedProject,
  mapId: string | undefined,
  revision: number,
): Promise<BuiltProject> {
  const initial = compileMap(parsed, mapId, { revision });
  const selectedId = initial.scene.map.id;
  const assets = new Map<string, Uint8Array>(),
    geometries = new Map<string, ModelGeometry>(),
    moduleUrls = new Map<string, string>();
  const textures = await loadBuiltinTextures();
  await Promise.all(
    Object.values(parsed.modules).map(async (definition) => {
      const file = path.posix.join(path.posix.dirname(definition.source.file), 'model.ts');
      try {
        const source = await readFile(await projectPath(root, file), 'utf8');
        const key = hash(source, JSON.stringify(definition.size), definition.material ?? 'white');
        let pending = models.get(key);
        if (!pending) {
          pending = (async () => {
            const geometry = await withModelSlot(() =>
              runModel(source, { size: definition.size, material: definition.material }),
            );
            return { geometry, glb: await modelToGlb(geometry, { textures }) };
          })();
          models.set(key, pending);
          pending.catch(() => models.delete(key));
          if (models.size > 256) models.delete(models.keys().next().value!);
        }
        const { geometry, glb } = await pending;
        const url = `/assets/modules/${definition.id}/${key}.glb`;
        assets.set(url, glb);
        geometries.set(definition.id, geometry);
        moduleUrls.set(definition.id, url);
      } catch (error) {
        initial.scene.fileErrors.push({
          file,
          line: 1,
          message: `${error instanceof Error ? error.message : String(error)} Fix the model and run check again.`,
        });
      }
    }),
  );
  let terrain = createTerrain(initial.scene.map.size.x, initial.scene.map.size.z);
  const terrainBase = path.posix.join(
    path.posix.dirname(parsed.maps[selectedId]?.source.file ?? `maps/${selectedId}/map.yaml`),
    'terrain',
  );
  try {
    const readOptional = async (file: string) => {
      try {
        return await readFile(await projectPath(root, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    };
    const [h, s] = await Promise.all([
      readOptional(`${terrainBase}/height.png`),
      readOptional(`${terrainBase}/surface.png`),
    ]);
    if (Boolean(h) !== Boolean(s))
      throw new Error(
        'Both height.png and surface.png are required when terrain PNGs are present.',
      );
    const key = hash(h ?? '', s ?? '', JSON.stringify(initial.scene.map.size));
    let pending = terrains.get(key);
    if (!pending) {
      pending = (async () => {
        const decoded = h && s ? decodeTerrain(h, s, initial.scene.map.size) : terrain;
        const terrainAssets = new Map<string, Uint8Array>();
        const chunks: Compilation['scene']['terrain']['chunks'] = [];
        for (const chunk of terrainChunks(decoded)) {
          const url = `/assets/terrain/${key}/${chunk.cx}-${chunk.cz}.glb`;
          terrainAssets.set(url, await terrainChunkGlb(chunk));
          chunks.push({ cx: chunk.cx, cz: chunk.cz, url });
        }
        return { terrain: decoded, assets: terrainAssets, chunks };
      })();
      terrains.set(key, pending);
      pending.catch(() => terrains.delete(key));
      if (terrains.size > 4) terrains.delete(terrains.keys().next().value!);
    }
    const built = await pending;
    // A caller may edit its TerrainData; content-addressed cached PNG geometry remains immutable.
    terrain = {
      ...built.terrain,
      heights: built.terrain.heights.slice(),
      surfaces: built.terrain.surfaces.slice(),
    };
    for (const [url, glb] of built.assets) assets.set(url, glb);
    initial.scene.terrain = { revision, chunks: built.chunks };
  } catch (error) {
    initial.scene.fileErrors.push({
      file: terrainBase,
      line: 1,
      message: `${error instanceof Error ? error.message : String(error)} Restore valid terrain PNGs.`,
    });
  }
  const cached: BuiltProject = {
    root,
    parsed,
    compilation: initial,
    scene: initial.scene,
    terrain,
    geometries,
    generated: [],
    assets,
    moduleUrls,
    heightAt: (x, z) => terrainHeightAt(terrain, x, z),
  };
  return buildFromParsed(parsed, mapId, revision, cached);
}
