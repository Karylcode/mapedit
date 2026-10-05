import './styles.css';
import { Box3, Vector3 } from 'three';
import type { ObjectRef, SceneSnapshot } from '@mapedit/protocol';
import { Connection, socketUrl } from '../net/connection.js';
import { initialLang, liveTranslator, saveLang, translator, type Lang } from '../i18n/i18n.js';
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
import { shortcutFor } from './keys.js';
import { EditController } from './editing.js';
import { FileErrorFilter, noticeToast, onDrawnMap } from './notices.js';
import { wholeObjects } from './describe.js';
import { TitleBlock } from './hud/title-block.js';
import { StatusCard } from './hud/status-card.js';
import { Tooltip } from './hud/tooltip.js';
import { ActionBar } from './hud/action-bar.js';
import { HistoryPanel } from './hud/history-panel.js';
import { IssuesPanel } from './hud/issues-panel.js';
import { Toasts } from './hud/toasts.js';
import { CursorNote } from './hud/cursor-note.js';

const reducedMotion = (): boolean =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** How long the outline around objects the Agent just changed stays, in milliseconds. */
const FLASH_MS = 1600;

export function start(root: HTMLElement = document.body): void {
  const store = new Store<EditorState>(initialState(initialLang()));
  const t = liveTranslator(() => store.state.lang);
  const connection = new Connection({ url: socketUrl(location), client: 'editor' });
  const map = new MapView(new AssetCache());
  const index = () => map.index;

  const stage = h('div', { class: 'stage' });
  const hud = h('div', { class: 'hud' });
  root.append(h('main', { class: 'editor' }, stage, hud));
  const viewport = new Viewport(stage, map);
  const controls = new OverviewControls(viewport.overview, viewport.camera, map);

  /**
   * True once the open map's own snapshot is drawn. Until then the screen
   * still shows the previous map, which must not be picked or edited.
   */
  const ready = (): boolean => store.state.scene?.map.id === store.state.mapId;

  /** Keep the open map in the address, so a reload opens it again. */
  const showMapInAddress = (mapId: string | undefined): void => {
    const url = new URL(location.href);
    if (mapId === undefined) url.searchParams.delete('map');
    else url.searchParams.set('map', mapId);
    history.replaceState(null, '', url);
  };

  const openMap = (mapId: string): void => {
    if (store.state.mapId === mapId && connection.currentMap === mapId) return;
    edits.cancelDrag();
    input.cancelGesture();
    input.leaveFirstPerson();
    store.set({
      mapId,
      scene: undefined,
      revision: undefined,
      loadingMap: true,
      selection: undefined,
      hover: undefined,
      focusedViolation: undefined,
    });
    showMapInAddress(mapId);
    connection.openMap(mapId);
  };

  /** The server refused the map asked for and kept its open one: show that one again. */
  const returnToOpenMap = (): void => {
    const mapId = connection.currentMap;
    if (mapId === store.state.mapId) return;
    const drawn = mapId !== undefined && map.scene?.map.id === mapId ? map.scene : undefined;
    store.set({
      mapId,
      scene: drawn,
      revision: drawn?.revision,
      loadingMap: mapId !== undefined && !drawn,
    });
    showMapInAddress(mapId);
  };

  /**
   * The Agent deleted a map: it leaves the map list, and if it is the open one,
   * it stays drawn but out of reach until another map is chosen.
   */
  const mapDeleted = (mapId: string): void => {
    const project = store.state.project;
    if (project)
      store.set({ project: { ...project, maps: project.maps.filter((m) => m.id !== mapId) } });
    if (store.state.mapId !== mapId) return;
    edits.cancelDrag();
    input.cancelGesture();
    input.leaveFirstPerson();
    store.set({
      mapId: undefined,
      loadingMap: false,
      selection: undefined,
      hover: undefined,
      focusedViolation: undefined,
    });
    showMapInAddress(undefined);
  };
  const setLang = (lang: Lang): void => {
    saveLang(lang);
    store.set({ lang });
  };

  /** Fly so a box fills the view. */
  const flyToBox = (bounds: Box3, minRadius = 2): void => {
    const { fov } = viewport.overview;
    const { aspect } = viewport.camera;
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, minRadius);
    controls.flyTo(
      bounds.getCenter(new Vector3()),
      fitDistance(radius * 1.3, fov, aspect),
      reducedMotion() ? 0 : 0.35,
    );
    viewport.invalidate();
  };

  /** Fly to the selection, or to the whole map when nothing is selected. */
  const focus = (): void => {
    const ref = store.state.selection;
    const bounds = ref ? map.boundsOf(ref) : undefined;
    if (bounds) return flyToBox(bounds);
    const { fov } = viewport.overview;
    const { aspect } = viewport.camera;
    const framing = viewport.overview.mapFraming(fov, aspect);
    framing.target.y = map.heightAt(framing.target.x, framing.target.z) ?? 0;
    controls.flyTo(framing.target, framing.distance, reducedMotion() ? 0 : 0.35);
    viewport.invalidate();
  };

  /** Pick a violation in the list: fly to it and outline what it names; again to let go. */
  const focusViolation = (id: string): void => {
    const next = store.state.focusedViolation === id ? undefined : id;
    store.set({ focusedViolation: next });
    const violation = store.state.scene?.violations.find((v) => v.id === next);
    if (!violation) return;
    const bounds = new Box3();
    for (const ref of violation.refs) {
      const box = map.boundsOf(ref);
      if (box) bounds.union(box);
    }
    if (violation.location) bounds.expandByPoint(new Vector3(...violation.location));
    if (!bounds.isEmpty()) flyToBox(bounds, 4);
  };

  const toasts = new Toasts(t);
  const note = new CursorNote();
  const edits = new EditController(connection, store, map, viewport, toasts, note);

  const input: OverviewInput = new OverviewInput(viewport, map, controls, {
    click(hit) {
      const current = map.index;
      store.set({
        selection:
          current && ready() ? clickSelection(store.state.selection, hit, current) : undefined,
      });
    },
    hover(hit, x, y) {
      const previous = store.state.hover;
      if (!hit || !ready()) {
        if (previous) store.set({ hover: undefined });
      } else if (previous?.ref !== hit || previous.x !== x || previous.y !== y)
        store.set({ hover: { ref: hit, x, y } });
    },
    dragStart: (hit, pointer, client) => edits.beginDrag(hit, pointer, client),
    dragMove: (pointer, client) => edits.dragMove(pointer, client),
    dragEnd: (pointer, client) => edits.dragEnd(pointer, client),
    dragCancel: () => edits.cancelDrag(),
    key(event) {
      const shortcut = shortcutFor(event, edits.dragging);
      if (!shortcut) return false;
      if (input.firstPerson) {
        // First-person mode only looks around: V or Escape returns, undo and redo still work.
        if (shortcut.action === 'firstPerson' || shortcut.action === 'escape')
          input.leaveFirstPerson();
        else if (shortcut.action === 'undo') edits.undo();
        else if (shortcut.action === 'redo') edits.redo();
        return true;
      }
      switch (shortcut.action) {
        case 'undo':
          edits.undo();
          break;
        case 'redo':
          edits.redo();
          break;
        case 'rotate':
          edits.rotate(shortcut.direction);
          break;
        case 'delete':
          edits.deleteSelection();
          break;
        case 'focus':
          focus();
          break;
        case 'firstPerson':
          if (!ready()) break;
          if (edits.dragging) {
            edits.cancelDrag();
            input.cancelGesture();
          }
          input.enterFirstPerson();
          break;
        case 'escape':
          // Escape steps back one thing: the drag, then the picked violation, then the selection.
          if (edits.dragging) {
            edits.cancelDrag();
            input.cancelGesture();
          } else if (store.state.focusedViolation) store.set({ focusedViolation: undefined });
          else store.set({ selection: undefined });
          break;
      }
      return true;
    },
    modeChanged(firstPerson) {
      store.set({ firstPerson, hover: undefined });
    },
  });

  store.subscribe((state, previous) => {
    if (changed(state, previous, 'selection'))
      map.setOutlines('selection', state.selection ? [state.selection] : []);
    if (changed(state, previous, 'selection', 'hover', 'scene')) {
      // Outline what a click would select, unless it is already selected.
      const current = map.index;
      const target =
        state.hover && current
          ? clickSelection(state.selection, state.hover.ref, current)
          : undefined;
      const outlined: ObjectRef[] = target && target !== state.selection ? [target] : [];
      map.setOutlines('hover', outlined);
    }
    if (changed(state, previous, 'focusedViolation')) map.focusViolation(state.focusedViolation);
    if (changed(state, previous, 'lang')) toasts.setTranslator(translator(state.lang));
  });

  const updateProgress = (): void => {
    const progress = map.progress();
    const current = store.state.progress;
    if (progress.loaded !== current.loaded || progress.total !== current.total)
      store.set({ progress });
  };
  map.onChange(updateProgress);

  const fileErrors = new FileErrorFilter();
  const showScene = (scene: SceneSnapshot): void => {
    if (scene.map.id !== store.state.mapId) return;
    const previous = store.state.scene;
    const first = previous?.map.id !== scene.map.id;
    map.apply(scene);
    // The Agent may resize the map: keep the camera's limits and framing in step.
    const { x, z } = scene.map.size;
    if (first || previous.map.size.x !== x || previous.map.size.z !== z)
      viewport.overview.setMap(scene.map.size);
    if (first) {
      viewport.overview.frameMap(viewport.overview.fov, viewport.camera.aspect);
      viewport.invalidate();
      void map.settled().then(() => {
        if (store.state.scene?.map.id !== scene.map.id) return;
        controls.followTerrain();
        store.set({ loadingMap: false });
        viewport.invalidate();
      });
    }
    const focused = store.state.focusedViolation;
    store.set({
      scene,
      revision: scene.revision,
      selection: keepSelection(store.state.selection, map.index!),
      focusedViolation: scene.violations.some((v) => v.id === focused) ? focused : undefined,
    });
    fileErrors.update(scene);
    updateProgress();
    input.refreshHover();
  };

  let flash: number | undefined;
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
    else if (message.type === 'notice') {
      if (message.code === 'file_error' && !fileErrors.admit(message.message)) return;
      toasts.show(noticeToast(message, map.index, store.state.project));
      if (message.code === 'unknown_map')
        if (message.mapId === undefined) returnToOpenMap();
        else mapDeleted(message.mapId);
      // The scene comes before the notice, so the refs are found in the new snapshot.
      if (
        message.code === 'agent_changed' &&
        message.refs?.length &&
        onDrawnMap(message, map.index)
      ) {
        // Briefly outline what the Agent touched, so a watching human can spot it.
        map.setOutlines('flash', wholeObjects(message.refs, map.index));
        window.clearTimeout(flash);
        flash = window.setTimeout(() => map.setOutlines('flash', []), FLASH_MS);
      }
    }
  });

  hud.append(
    h(
      'div',
      { class: 'hud-column hud-left' },
      new TitleBlock(store, { openMap, setLang }).element,
      new IssuesPanel(store, index, { focusViolation }).element,
    ),
    h(
      'div',
      { class: 'hud-column hud-right' },
      new HistoryPanel(store, index, { undo: () => edits.undo(), redo: () => edits.redo() })
        .element,
      // Wide windows show toasts between the columns; narrow ones under the change log.
      toasts.element,
    ),
    new ActionBar(store, index).element,
    new StatusCard(store).element,
    new Tooltip(store, index).element,
    note.element,
    h('div', { class: 'crosshair', 'aria-hidden': 'true' }),
  );

  const editor = root.querySelector<HTMLElement>('.editor')!;
  const syncDocument = (state: EditorState) => {
    editor.dataset.mode = state.firstPerson ? 'first-person' : 'overview';
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
