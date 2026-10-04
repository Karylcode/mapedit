import './styles.css';
import { Vector3 } from 'three';
import type { ObjectRef, SceneSnapshot } from '@mapedit/protocol';
import { Connection, socketUrl } from '../net/connection.js';
import { initialLang, saveLang, translate, type Lang } from '../i18n/i18n.js';
import { AssetCache } from '../scene/assets.js';
import { MapView } from '../scene/map-view.js';
import { OverviewControls } from '../scene/overview-controls.js';
import { fitDistance } from '../scene/overview-camera.js';
import { h } from './dom.js';
import { Store, changed } from './store.js';
import { chooseMap, initialState, type EditorState } from './state.js';
import { Viewport } from './viewport.js';
import { OverviewInput } from './input.js';
import { clickSelection, keepSelection } from './selection.js';
import { EditController } from './editing.js';
import { TitleBlock } from './hud/title-block.js';
import { StatusCard } from './hud/status-card.js';
import { Tooltip } from './hud/tooltip.js';
import { ActionBar } from './hud/action-bar.js';
import { HistoryPanel } from './hud/history-panel.js';
import { Toasts } from './hud/toasts.js';
import { CursorNote } from './hud/cursor-note.js';

const reducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function start(root: HTMLElement = document.body): void {
  const store = new Store<EditorState>(initialState(initialLang()));
  const connection = new Connection({ url: socketUrl(location), client: 'editor' });
  const map = new MapView(new AssetCache());
  const index = () => map.index;

  const stage = h('div', { class: 'stage' });
  const hud = h('div', { class: 'hud' });
  root.append(h('main', { class: 'editor' }, stage, hud));
  const viewport = new Viewport(stage, map);
  const controls = new OverviewControls(viewport.overview, viewport.camera, map);

  const openMap = (mapId: string): void => {
    if (store.state.mapId === mapId && connection.currentMap === mapId) return;
    store.set({
      mapId,
      scene: undefined,
      revision: undefined,
      loadingMap: true,
      selection: undefined,
      hover: undefined,
    });
    const url = new URL(location.href);
    url.searchParams.set('map', mapId);
    history.replaceState(null, '', url);
    connection.openMap(mapId);
  };
  const setLang = (lang: Lang): void => {
    saveLang(lang);
    store.set({ lang });
  };

  /** Fly to the selection, or to the whole map when nothing is selected. */
  const focus = (): void => {
    const { fov, aspect } = viewport.camera;
    const ref = store.state.selection;
    const bounds = ref ? map.boundsOf(ref) : undefined;
    const duration = reducedMotion() ? 0 : 0.35;
    if (bounds) {
      const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 2);
      controls.flyTo(
        bounds.getCenter(new Vector3()),
        fitDistance(radius * 1.3, fov, aspect),
        duration,
      );
    } else {
      const framing = viewport.overview.mapFraming(fov, aspect);
      framing.target.y = map.heightAt(framing.target.x, framing.target.z) ?? 0;
      controls.flyTo(framing.target, framing.distance, duration);
    }
    viewport.invalidate();
  };

  const toasts = new Toasts();
  const note = new CursorNote();
  const edits = new EditController(connection, store, map, viewport, toasts, note);

  const input: OverviewInput = new OverviewInput(viewport, map, controls, {
    click(hit) {
      const current = map.index;
      store.set({
        selection: current ? clickSelection(store.state.selection, hit, current) : undefined,
      });
    },
    hover(hit, x, y) {
      const previous = store.state.hover;
      if (!hit) {
        if (previous) store.set({ hover: undefined });
      } else if (previous?.ref !== hit || previous.x !== x || previous.y !== y)
        store.set({ hover: { ref: hit, x, y } });
    },
    focus,
    escape() {
      store.set({ selection: undefined });
    },
    dragStart: (hit, pointer, client) => edits.beginDrag(hit, pointer, client),
    dragMove: (pointer, client) => edits.dragMove(pointer, client),
    dragEnd: (pointer, client) => edits.dragEnd(pointer, client),
    key(event) {
      const command = event.ctrlKey || event.metaKey;
      if (event.code === 'Escape' && edits.dragging) {
        edits.cancelDrag();
        input.cancelGesture();
        return true;
      }
      if (command && event.code === 'KeyZ') {
        if (event.shiftKey) edits.redo();
        else edits.undo();
        return true;
      }
      if (command && event.code === 'KeyY') {
        edits.redo();
        return true;
      }
      if (command || event.altKey) return false;
      if (event.code === 'KeyR') {
        // Holding R turns a dragged preview continuously, but never re-applies edits.
        if (!event.repeat || edits.dragging) edits.rotate(event.shiftKey ? -1 : 1);
        return true;
      }
      if (event.code === 'Delete' || event.code === 'Backspace') {
        if (!event.repeat) edits.deleteSelection();
        return true;
      }
      return false;
    },
  });

  store.subscribe((state, previous) => {
    if (changed(state, previous, 'selection'))
      map.setSelection(state.selection ? [state.selection] : []);
    if (changed(state, previous, 'selection', 'hover', 'scene')) {
      // Outline what a click would select, unless it is already selected.
      const current = map.index;
      const target =
        state.hover && current
          ? clickSelection(state.selection, state.hover.ref, current)
          : undefined;
      const outlined: ObjectRef[] = target && target !== state.selection ? [target] : [];
      map.setHover(outlined);
    }
  });

  const updateProgress = (): void => {
    const progress = map.progress();
    const current = store.state.progress;
    if (progress.loaded !== current.loaded || progress.total !== current.total)
      store.set({ progress });
  };
  map.onChange(updateProgress);

  const showScene = (scene: SceneSnapshot): void => {
    if (scene.map.id !== store.state.mapId) return;
    const first = store.state.scene?.map.id !== scene.map.id;
    map.apply(scene);
    if (first) {
      viewport.overview.setMap(scene.map.size);
      viewport.overview.frameMap(viewport.camera.fov, viewport.camera.aspect);
      viewport.invalidate();
      void map.settled().then(() => {
        if (store.state.scene?.map.id !== scene.map.id) return;
        controls.followTerrain();
        store.set({ loadingMap: false });
        viewport.invalidate();
      });
    }
    store.set({
      scene,
      revision: scene.revision,
      selection: keepSelection(store.state.selection, map.index!),
    });
    updateProgress();
    input.refreshHover();
  };

  connection.on('status', (status) => store.set({ status }));
  connection.on('welcome', (project) => {
    store.set({ project });
    const requested = store.state.mapId ?? new URL(location.href).searchParams.get('map');
    const mapId = chooseMap(project, requested);
    if (mapId) openMap(mapId);
  });
  connection.on('message', (message) => {
    if (message.type === 'scene') showScene(message.scene);
    else if (message.type === 'history')
      store.set({ history: { entries: message.entries, cursor: message.cursor } });
  });

  hud.append(
    new TitleBlock(store, { openMap, setLang }).element,
    new HistoryPanel(store, index, { undo: () => edits.undo(), redo: () => edits.redo() }).element,
    new ActionBar(store, index).element,
    new StatusCard(store).element,
    toasts.element,
    new Tooltip(store, index).element,
    note.element,
  );
  const syncToasts = (state: EditorState) =>
    toasts.setDismissLabel(translate(state.lang, 'notice.dismiss'));
  store.subscribe(syncToasts);
  syncToasts(store.state);

  const syncDocument = (state: EditorState) => {
    document.documentElement.lang = state.lang;
    document.title = state.project ? `${state.project.name} · mapedit` : 'mapedit';
  };
  store.subscribe(syncDocument);
  syncDocument(store.state);
  connection.start();
  // Read-only handle for browser tests and debugging from the console.
  Object.assign(globalThis, {
    mapeditEditor: { store, viewport, map, connection, controls, input, edits, toasts },
  });
}
