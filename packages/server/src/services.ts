import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import {
  applyTerrainCommand,
  encodeTerrain,
  terrainHeightAt,
  terrainSurfaceAt,
  transformMatrix,
  type TerrainCommand,
} from '@mapedit/core';
import type { SceneSnapshot } from '@mapedit/protocol';
import type { AgentServices } from './mcp.js';
import { DiskState } from './disk-state.js';
import { ScreenshotService } from './screenshot.js';
import { exportBuiltProject } from './export-project.js';

export function createAgentServices(
  state: DiskState,
  screenshots: ScreenshotService,
): AgentServices {
  const current = () => state.builds.get(state.scene.map.id) ?? state.builds.values().next().value!;
  return {
    flush: () => state.flush(),
    getScene: (id) => state.getScene(id),
    getCompilation: async (id) => (await state.getBuild(id)).compilation,
    getModules: () =>
      Object.values(current().parsed.modules).sort((a, b) => a.id.localeCompare(b.id)),
    compatibleSocketTypes: (type) => {
      const types = current().parsed.project.socketTypes;
      return Object.keys(types).filter(
        (candidate) =>
          types[type]?.compatibleWith.includes(candidate) ||
          types[candidate]?.compatibleWith.includes(type),
      );
    },
    async query(mapId, x, z) {
      const build = await state.getBuild(mapId);
      if (x < 0 || z < 0 || x > build.terrain.width || z > build.terrain.depth)
        throw new Error('Query position is outside the map.');
      const objects = build.compilation.instances
        .filter(
          (i) =>
            x >= i.bounds.min[0] &&
            x <= i.bounds.max[0] &&
            z >= i.bounds.min[2] &&
            z <= i.bounds.max[2],
        )
        .map((i) => ({ ref: i.ref, bounds: i.bounds }));
      return {
        x,
        z,
        height: terrainHeightAt(build.terrain, x, z),
        surface: terrainSurfaceAt(build.terrain, x, z),
        objects: objects.slice(0, 100),
        total: objects.length,
        note: 'Objects are candidates whose bounds cover this X/Z location.',
      };
    },
    async buildModule(id) {
      const build = current(),
        definition = build.parsed.modules[id];
      if (!definition) throw new Error(`Module '${id}' does not exist.`);
      const errors = build.scene.fileErrors.filter((e) =>
        e.file.startsWith(definition.source.file.replace(/module\.yaml$/, '')),
      );
      const geometry = build.geometries.get(id);
      if (!geometry || errors.length) return { summary: { module: id, ok: false, errors } };
      const temporaryId = `__module_${randomUUID()}`;
      const ref = `module:preview/${id}`;
      const preview: SceneSnapshot = {
        protocolVersion: 1,
        revision: build.scene.revision,
        map: {
          id: temporaryId,
          name: definition.name,
          size: { x: 100, z: 100 },
          sun: build.scene.map.sun,
        },
        terrain: { revision: 0, chunks: [] },
        moduleTypes: build.scene.moduleTypes.filter((module) => module.id === id),
        structures: [
          {
            ref: 'structure:preview',
            file: definition.source.file,
            transform: transformMatrix([0, 0, 0]),
            instances: [{ ref, moduleType: id, transform: transformMatrix([0, 0, 0]) }],
          },
        ],
        generated: [],
        markers: [],
        violations: [],
        fileErrors: [],
      };
      state.previewScenes.set(temporaryId, preview);
      try {
        const image = await screenshots.capture(temporaryId, {
          views: ['top', 'ne', 'nw', 'se', 'sw'],
          tileSize: 256,
          focus: {
            center: [definition.size[0] / 2, definition.size[1] / 2, definition.size[2] / 2],
            radius: Math.max(1, Math.hypot(...definition.size) / 2),
          },
          minRevision: preview.revision,
        });
        return {
          summary: {
            module: id,
            ok: true,
            triangles: geometry.indices.length / 3,
            bounds: geometry.bounds,
          },
          preview: image,
        };
      } catch (error) {
        return {
          summary: {
            module: id,
            ok: true,
            triangles: geometry.indices.length / 3,
            previewError: error instanceof Error ? error.message : String(error),
          },
        };
      } finally {
        state.previewScenes.delete(temporaryId);
      }
    },
    async terrain(mapId, command) {
      await state.updateAgentFiles(async () => {
        const build = await state.getBuild(mapId);
        const changed = applyTerrainCommand(build.terrain, command as unknown as TerrainCommand);
        const png = encodeTerrain(changed);
        const folder = `${posix.dirname(build.parsed.maps[build.scene.map.id]!.source.file)}/terrain`;
        return { [`${folder}/height.png`]: png.height, [`${folder}/surface.png`]: png.surface };
      });
      const scene = await state.getScene(mapId);
      return {
        map: scene.map.id,
        revision: scene.revision,
        violations: scene.violations.length,
        fileErrors: scene.fileErrors.length,
      };
    },
    async export(mapId, out) {
      return { file: await exportBuiltProject(await state.getBuild(mapId), out) };
    },
  };
}
