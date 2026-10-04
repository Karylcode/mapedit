import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Vector2 } from 'three';
import { mockScene } from '@mapedit/server';
import type { ClientMessage, SceneSnapshot, ServerMessage } from '@mapedit/protocol';
import { Store } from '../src/editor/store.js';
import { initialState, type EditorState } from '../src/editor/state.js';
import { EditController } from '../src/editor/editing.js';
import { MapView } from '../src/scene/map-view.js';
import { AssetCache } from '../src/scene/assets.js';
import { OverviewCamera } from '../src/scene/overview-camera.js';
import { installFakeCanvas } from './fake-canvas.js';

installFakeCanvas();

type Listener = (value: never) => void;

/** An EditController wired to a fake connection that records what it sends. */
function setup(scene: SceneSnapshot = mockScene()) {
  const map = new MapView(new AssetCache(() => new Promise<ArrayBuffer>(() => {})));
  map.apply(scene);
  const store = new Store<EditorState>({
    ...initialState('en'),
    status: 'open',
    mapId: scene.map.id,
    scene,
    revision: scene.revision,
  });
  const listeners: Record<string, Set<Listener>> = { message: new Set(), status: new Set() };
  const sent: ClientMessage[] = [];
  let nextId = 1;
  const connection = {
    status: 'open',
    currentMap: scene.map.id,
    on(event: string, listener: Listener) {
      listeners[event]!.add(listener);
      return () => listeners[event]!.delete(listener);
    },
    request(message: object) {
      const requestId = nextId++;
      sent.push({ ...message, requestId } as ClientMessage);
      return requestId;
    },
  };
  const overview = new OverviewCamera();
  overview.setMap(scene.map.size);
  overview.frameMap(40, 1.6);
  const viewport = {
    addTask: () => () => {},
    invalidate() {},
    scene: new Scene(),
    camera: new PerspectiveCamera(40, 1.6),
    overview,
    renderer: { getPixelRatio: () => 1 },
    size: new Vector2(1280, 800),
  };
  const toasts = { show: vi.fn() };
  const note = { show: vi.fn(), move: vi.fn(), hide: vi.fn() };
  const edits = new EditController(
    connection as never,
    store,
    map,
    viewport as never,
    toasts as never,
    note as never,
  );
  const emit = (message: ServerMessage) => {
    for (const listener of listeners.message!) listener(message as never);
  };
  const applied = () =>
    sent.filter((m): m is Extract<ClientMessage, { type: 'applyEdit' }> => m.type === 'applyEdit');
  return { edits, store, map, sent, applied, emit, toasts, note };
}

describe('EditController before the backend answers', () => {
  it('keeps turning from the last angle sent when R is pressed quickly (FE5)', () => {
    const { edits, store, applied } = setup();
    store.set({ selection: 'structure:house' });
    edits.rotate(1);
    edits.rotate(1);
    edits.rotate(1);
    const rotations = applied().map((m) => (m.edit.kind === 'move' ? m.edit.rotation : -1));
    expect(rotations).toEqual([15, 30, 45]);
  });

  it('sends one delete when Delete is pressed twice, and no error afterwards (FE5)', () => {
    const { edits, store, applied, emit, toasts } = setup();
    store.set({ selection: 'structure:house' });
    edits.deleteSelection();
    edits.deleteSelection();
    expect(applied()).toHaveLength(1);
    emit({ type: 'editResult', requestId: applied()[0]!.requestId, ok: true });
    // The new snapshot has not arrived yet: the house is still drawn and selected.
    edits.deleteSelection();
    expect(applied()).toHaveLength(1);
    expect(toasts.show).not.toHaveBeenCalled();
  });

  it('asks the human to wait instead of panning when dragging a changing object (FE5)', () => {
    const { edits, store, toasts } = setup();
    store.set({ selection: 'structure:house' });
    edits.rotate(1);
    const result = edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    expect(result).toBe('blocked');
    expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ key: 'edit.busy' }));
  });
});
