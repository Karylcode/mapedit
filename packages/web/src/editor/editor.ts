import './styles.css';
import type { SceneSnapshot } from '@mapedit/protocol';
import { Connection, socketUrl } from '../net/connection.js';
import { initialLang, saveLang, type Lang } from '../i18n/i18n.js';
import { AssetCache } from '../scene/assets.js';
import { MapView } from '../scene/map-view.js';
import { h } from './dom.js';
import { Store } from './store.js';
import { chooseMap, initialState, type EditorState } from './state.js';
import { Viewport } from './viewport.js';
import { TitleBlock } from './hud/title-block.js';
import { StatusCard } from './hud/status-card.js';

export function start(root: HTMLElement = document.body): void {
  const store = new Store<EditorState>(initialState(initialLang()));
  const connection = new Connection({ url: socketUrl(location), client: 'editor' });
  const map = new MapView(new AssetCache());

  const stage = h('div', { class: 'stage' });
  const hud = h('div', { class: 'hud' });
  root.append(h('main', { class: 'editor' }, stage, hud));
  const viewport = new Viewport(stage, map);

  const openMap = (mapId: string): void => {
    if (store.state.mapId === mapId && connection.currentMap === mapId) return;
    store.set({ mapId, scene: undefined, revision: undefined, loadingMap: true });
    const url = new URL(location.href);
    url.searchParams.set('map', mapId);
    history.replaceState(null, '', url);
    connection.openMap(mapId);
  };
  const setLang = (lang: Lang): void => {
    saveLang(lang);
    store.set({ lang });
  };

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
        if (store.state.scene?.map.id === scene.map.id) store.set({ loadingMap: false });
      });
    }
    store.set({ scene, revision: scene.revision });
    updateProgress();
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

  hud.append(new TitleBlock(store, { openMap, setLang }).element, new StatusCard(store).element);

  const syncDocument = (state: EditorState) => {
    document.documentElement.lang = state.lang;
    document.title = state.project ? `${state.project.name} · mapedit` : 'mapedit';
  };
  store.subscribe(syncDocument);
  syncDocument(store.state);
  connection.start();
  // Read-only handle for browser tests and debugging from the console.
  Object.assign(globalThis, { mapeditEditor: { store, viewport, map, connection } });
}
