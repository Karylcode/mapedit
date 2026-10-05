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
import { translate } from '../src/i18n/i18n.js';
import type { Localized } from '../src/editor/hud/toasts.js';
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
  const tasks: (() => boolean)[] = [];
  const viewport = {
    addTask: (task: () => boolean) => {
      tasks.push(task);
      return () => {};
    },
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
  const setStatus = (status: string) => {
    connection.status = status;
    for (const listener of listeners.status!) listener(status as never);
  };
  const applied = () =>
    sent.filter((m): m is Extract<ClientMessage, { type: 'applyEdit' }> => m.type === 'applyEdit');
  /** One animation frame: a drag asks for its preview. */
  const frame = () => tasks.forEach((task) => task());
  return { edits, store, map, sent, applied, emit, setStatus, toasts, note, viewport, frame };
}

/** A toast's text or detail in English. */
const english = (value: unknown) =>
  typeof value === 'function'
    ? (value as Localized)((key, params) => translate('en', key, params))
    : value;

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

  it('removes the preview of an applied drop even if no snapshot follows (FE9)', () => {
    vi.useFakeTimers();
    try {
      const { edits, applied, emit, viewport } = setup();
      expect(edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 })).toBe(
        'drag',
      );
      edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
      const drop = applied().at(-1)!;
      emit({ type: 'editResult', requestId: drop.requestId, ok: true });
      expect(viewport.scene.getObjectByName('ghost')).toBeDefined();
      vi.advanceTimersByTime(2_500);
      expect(viewport.scene.getObjectByName('ghost')).toBeUndefined();
      // The house can be dragged again.
      expect(edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 })).toBe(
        'drag',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends Ctrl+Z pressed right after a drop once the drop is answered (FE9)', () => {
    const { edits, sent, applied, emit } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    edits.undo();
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(0);
    emit({ type: 'editResult', requestId: applied().at(-1)!.requestId, ok: true });
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(1);
  });

  it('drops a queued Ctrl+Z when the backend refuses the drop, and says so (FE24)', () => {
    const { edits, sent, applied, emit, toasts } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    edits.undo();
    emit({
      type: 'editResult',
      requestId: applied().at(-1)!.requestId,
      ok: false,
      failure: 'violations',
      reason: 'Overlaps structure:overlap_a.',
    });
    // Undoing now would undo the change before the drop, perhaps the Agent's.
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(0);
    expect(toasts.show).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'edit.queuedDropped' }),
    );
  });

  it('forgets a queued Ctrl+Z when its drag is cancelled, as on switching maps (FE24)', () => {
    const { edits, sent, applied, emit } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    const first = applied().at(-1)!.requestId;
    edits.undo();
    // Switching maps cancels the drag; the first drop's answer comes in afterwards.
    edits.cancelDrag();
    emit({ type: 'editResult', requestId: first, ok: true });
    // The next drop's answer must not release the undo pressed for the first one.
    expect(edits.beginDrag('module:socket_a/base', new Vector2(0, 0), { x: 640, y: 400 })).toBe(
      'drag',
    );
    edits.dragEnd(new Vector2(0.2, 0.1), { x: 720, y: 360 });
    const second = applied().at(-1)!.requestId;
    expect(second).not.toBe(first);
    emit({ type: 'editResult', requestId: second, ok: true });
    expect(sent.filter((m) => m.type === 'undo')).toHaveLength(0);
  });

  it('asks the human to wait when Delete is pressed while a drop awaits its answer (FE29)', () => {
    const { edits, applied, toasts } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    expect(applied()).toHaveLength(1);
    edits.deleteSelection();
    expect(applied()).toHaveLength(1);
    expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ key: 'edit.busy' }));
  });

  it('says the outcome is unknown when the connection drops after a drop (FE9)', () => {
    const { edits, toasts, setStatus } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    setStatus('reconnecting');
    expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ key: 'edit.uncertain' }));
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

describe('EditController reads failure codes, not English (FE17)', () => {
  const lastToast = (toasts: { show: ReturnType<typeof vi.fn> }) =>
    toasts.show.mock.calls.at(-1)![0] as { level: string; text: unknown; detail?: unknown };

  it('says there is nothing to undo from the failure code alone', () => {
    const { edits, sent, emit, toasts } = setup();
    edits.undo();
    emit({
      type: 'editResult',
      requestId: (sent.at(-1) as { requestId: number }).requestId,
      ok: false,
      failure: 'nothing_to_undo',
      reason: 'The history is at its start.',
    });
    expect(lastToast(toasts)).toMatchObject({ level: 'info' });
    expect(english(lastToast(toasts).text)).toBe('Nothing to undo');
  });

  it('reports a failed redo whatever its English reason says', () => {
    const { edits, sent, emit, toasts } = setup();
    edits.redo();
    emit({
      type: 'editResult',
      requestId: (sent.at(-1) as { requestId: number }).requestId,
      ok: false,
      failure: 'internal_error',
      reason: 'Nothing to redo: a file could not be read.',
    });
    expect(lastToast(toasts)).toMatchObject({ level: 'warning' });
    expect(english(lastToast(toasts).text)).toBe('Redo failed');
  });

  it('tells a dragged object cannot move while a file is unreadable', () => {
    const { edits, sent, emit, note, frame } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragMove(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    frame();
    const preview = sent.filter((m) => m.type === 'previewEdit').at(-1)!;
    emit({
      type: 'previewResult',
      requestId: preview.requestId,
      ok: false,
      violations: [],
      failure: 'file_errors',
    });
    expect(note.show).toHaveBeenLastCalledWith(
      'A file could not be read; fix it before moving anything',
      undefined,
      700,
      380,
    );
  });

  it('explains a drop refused because of file errors', () => {
    const { edits, applied, emit, toasts } = setup();
    edits.beginDrag('module:house/base', new Vector2(0, 0), { x: 640, y: 400 });
    edits.dragEnd(new Vector2(0.1, 0.05), { x: 700, y: 380 });
    emit({
      type: 'editResult',
      requestId: applied().at(-1)!.requestId,
      ok: false,
      failure: 'file_errors',
      reason: 'Fix the file errors first.',
    });
    expect(english(lastToast(toasts).text)).toBe('House was not moved');
    expect(english(lastToast(toasts).detail)).toBe(
      'A file could not be read; fix it before moving anything',
    );
  });
});
