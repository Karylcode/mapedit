import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { markerRef, structureRef, type SceneSnapshot } from '@mapedit/protocol';
import { createServer } from '../src/index.js';
import { MemoryState } from '../src/state.js';
import type { DiskState } from '../src/disk-state.js';
import { createAgentServices } from '../src/services.js';
import type { ScreenshotService } from '../src/screenshot.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

const structure = (id: string, x: number) =>
  `structures:\n  - id: ${id}\n    position: [${x}, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n`;
async function realProject() {
  const root = await mkdtemp(join(tmpdir(), 'mapedit-structured-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    'project.yaml': 'name: Structured fields\n',
    'modules/block/module.yaml': 'size: [2, 2, 2]\n',
    'modules/block/model.ts': "import {box} from '@mapedit/model'; export default box([2,2,2]);",
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/structures/a.yaml': structure('a', 10),
    'maps/village/structures/b.yaml': structure('b', 20),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
  }
  const server = await createServer({ root, port: 0, webRoot: null });
  cleanup.push(() => server.close());
  return { root, state: server.state as DiskState };
}
const fields = (state: { entries: { author: string; action?: string; refs?: string[] }[] }) =>
  state.entries.map(({ author, action, refs }) => ({
    author,
    action,
    refs: refs && [...refs].sort(),
  }));

describe('F34 history entries carry their action and refs', () => {
  it('records moves, deletes and Agent changes on a real project', async () => {
    const { root, state } = await realProject();
    const notices: string[][] = [];
    state.on('message', (message) => {
      if (message.type === 'notice' && message.code === 'agent_changed')
        notices.push([...(message.refs ?? [])].sort());
    });
    const move = { kind: 'move', ref: 'structure:a', position: [30, 0, 30], rotation: 0 } as const;
    expect(await state.apply(move, state.scene.revision, 'village')).toBeUndefined();
    expect(
      await state.apply({ kind: 'delete', ref: 'structure:b' }, state.scene.revision, 'village'),
    ).toBeUndefined();
    await writeFile(join(root, 'maps/village/structures/a.yaml'), structure('a', 50));
    await state.flush();
    expect(fields(state)).toEqual([
      { author: 'human', action: 'move', refs: ['structure:a'] },
      { author: 'human', action: 'delete', refs: ['structure:b'] },
      { author: 'agent', action: 'agent_change', refs: notices[0] },
    ]);
    expect(notices[0]).toContain('structure:a');
  });

  it('records the same fields in mock mode', async () => {
    const state = new MemoryState();
    const house = structureRef('house');
    expect(
      await state.apply(
        { kind: 'move', ref: house, position: [12, 0, 12], rotation: 0 },
        state.scene.revision,
      ),
    ).toBeUndefined();
    expect(
      await state.apply({ kind: 'delete', ref: markerRef('spawn') }, state.scene.revision),
    ).toBeUndefined();
    await state.triggerMockNotice('agent_changed');
    expect(fields(state)).toEqual([
      { author: 'human', action: 'move', refs: [house] },
      { author: 'human', action: 'delete', refs: [markerRef('spawn')] },
      { author: 'agent', action: 'agent_change', refs: [house] },
    ]);
  });
});

describe('F34 module previews are marked in MapInfo', () => {
  it('marks project maps as maps and the build_module scene as a module preview', async () => {
    const { state } = await realProject();
    expect(state.scene.map.kind).toBe('map');
    expect(new MemoryState().scene.map.kind).toBe('map');
    let preview: SceneSnapshot | undefined;
    const screenshots = {
      async capture(mapId: string) {
        preview = await state.getScene(mapId);
        throw new Error('No browser in this test.');
      },
    } as unknown as ScreenshotService;
    const result = await createAgentServices(state, screenshots).buildModule('block');
    expect(result.summary).toMatchObject({ ok: true, previewError: 'No browser in this test.' });
    expect(preview?.map.kind).toBe('module_preview');
    expect(preview?.structures).toHaveLength(1);
  });
});
