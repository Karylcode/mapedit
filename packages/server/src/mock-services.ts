import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseProject, compatibleSocketTypes, transformMatrix } from '@mapedit/core';
import { NOTICE_CODES, structureRef, type NoticeCode } from '@mapedit/protocol';
import type { AgentServices } from './mcp.js';
import type { MemoryState } from './state.js';
import type { ScreenshotService } from './screenshot.js';
import { boxGlb, mockScene } from './mock.js';
import { UnknownMapError } from './notice.js';

export function parseMockNotice(value: unknown): NoticeCode {
  const code =
    value && typeof value === 'object' && 'notice' in value
      ? NOTICE_CODES.find((code) => code === value.notice)
      : undefined;
  if (!code) throw new Error('Expected a known notice code in {"notice": NoticeCode}.');
  return code;
}

/** Run the same in-memory edit/history transitions that produce real concurrency notices. */
export async function triggerMockNotice(state: MemoryState, code: NoticeCode): Promise<void> {
  const ref = structureRef('house');
  const move = {
    kind: 'move' as const,
    ref,
    position: [12, 0, 12] as [number, number, number],
    rotation: 0,
  };
  const agentMove = () => {
    const scene = structuredClone(state.scene);
    let house = scene.structures.find((structure) => structure.ref === ref);
    if (!house) {
      house = mockScene().structures[0]!;
      scene.structures.unshift(house);
    }
    const position: [number, number, number] = [house.transform[12] === 14 ? 16 : 14, 0, 14];
    const delta = position.map((coordinate, axis) => coordinate - house.transform[12 + axis]!);
    for (const instance of house.instances)
      for (let axis = 0; axis < 3; axis++) instance.transform[12 + axis]! += delta[axis]!;
    house.transform = transformMatrix(position);
    state.replaceFromAgent(scene, [ref]);
  };
  switch (code) {
    case 'agent_changed':
      agentMove();
      return;
    case 'overwritten_by_agent':
      if (!state.scene.structures.some((structure) => structure.ref === ref))
        state.scene.structures.unshift(mockScene().structures[0]!);
      await state.apply(move, state.scene.revision);
      agentMove();
      return;
    case 'agent_change_overridden': {
      const baseRevision = state.scene.revision;
      agentMove();
      await state.apply(move, baseRevision);
      state.broadcast();
      return;
    }
    case 'edit_rejected':
      await state.apply({ ...move, position: [-10, 0, 10] }, state.scene.revision);
      return;
    case 'file_error': {
      const scene = structuredClone(state.scene);
      const file = `maps/village/structures/broken-${state.scene.revision + 1}.yaml`;
      scene.fileErrors.push({
        file,
        line: 2,
        message: `Invalid YAML in ${file}: close the opening bracket on line 2.`,
      });
      state.replaceFromAgent(scene, [], [file]);
      return;
    }
    case 'unknown_map':
      // What openMap answers for a map the Agent has just deleted.
      state.notice('unknown_map', new UnknownMapError('deleted_map').message);
      return;
  }
}

/** Predictable responses for front-end and transport development without a project. */
export function createMockServices(
  state: MemoryState,
  screenshots: ScreenshotService,
): AgentServices {
  const parsed = parseProject({
    'project.yaml': 'name: Mock project\n',
    'modules/block/module.yaml': 'id: block\nname: Block\nsize: [2, 2, 2]\n',
    'modules/foundation/module.yaml':
      'id: foundation\nname: Foundation\nsize: [2, 2, 2]\nisFoundation: true\n',
  });
  return {
    flush: () => state.flush(),
    projectRevision: () => state.scene.revision,
    getScene: (id) => state.getScene(id),
    getScenes: async (id) => [await state.getScene(id)],
    async getCompilation() {
      return undefined;
    },
    getModules: () => Object.values(parsed.modules),
    compatibleSocketTypes: (type) => compatibleSocketTypes(parsed.project.socketTypes, type),
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
      if (!parsed.modules[id]) throw new Error(`Module '${id}' does not exist.`);
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
      const scene = structuredClone(state.scene);
      scene.terrain.revision++;
      state.replaceFromAgent(scene, [], ['maps/village/terrain/height.png']);
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
