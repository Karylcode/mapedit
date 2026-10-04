import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseProject } from '@mapedit/core';
import type { AgentServices } from './mcp.js';
import type { StateStore } from './state.js';
import { MemoryState } from './state.js';
import { ScreenshotService } from './screenshot.js';
import { boxGlb } from './mock.js';

/** Predictable responses for front-end and transport development without a project. */
export function createMockServices(
  state: StateStore,
  screenshots: ScreenshotService,
): AgentServices {
  const parsed = parseProject({
    'project.yaml': 'name: Mock project\n',
    'modules/block/module.yaml': 'id: block\nname: Block\nsize: [2, 2, 2]\n',
  });
  return {
    flush: () => state.flush(),
    async getScene(id) {
      if (state.getScene) return state.getScene(id);
      if (id) await state.openMap(id);
      return state.scene;
    },
    async getCompilation() {
      return undefined;
    },
    getModules: () => Object.values(parsed.modules),
    compatibleSocketTypes: (type) => parsed.project.socketTypes[type]?.compatibleWith ?? [],
    async query(_map, x, z) {
      return {
        x,
        z,
        height: 0,
        surface: 'grass',
        objects: state.scene.structures
          .flatMap((s) => s.instances)
          .filter(
            (i) =>
              x >= i.transform[12]! &&
              x <= i.transform[12]! + 2 &&
              z >= i.transform[14]! &&
              z <= i.transform[14]! + 2,
          )
          .map((i) => i.ref),
      };
    },
    async buildModule(id) {
      if (id !== 'block') throw new Error(`Module '${id}' does not exist.`);
      return {
        summary: { module: id, ok: true, mock: true },
        preview: await screenshots.capture(state.scene.map.id, {
          views: ['top', 'ne', 'nw', 'se', 'sw'],
          tileSize: 128,
          minRevision: state.scene.revision,
        }),
      };
    },
    async terrain(_map, command) {
      if (state instanceof MemoryState) {
        const scene = structuredClone(state.scene);
        scene.terrain.revision++;
        state.replaceFromAgent(scene, [], ['maps/village/terrain/height.png']);
      }
      return { mock: true, command, revision: state.scene.revision };
    },
    async export(_map, out) {
      const folder = resolve(out);
      await mkdir(folder, { recursive: true });
      const file = resolve(folder, 'village.glb');
      await writeFile(file, boxGlb());
      return { mock: true, file };
    },
  };
}
