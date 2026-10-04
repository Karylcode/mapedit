import './styles.css';
import { Connection, socketUrl } from '../net/connection.js';
import { initialLang, saveLang, type Lang } from '../i18n/i18n.js';
import { h } from './dom.js';
import { Store } from './store.js';
import { chooseMap, type EditorState } from './state.js';
import { TitleBlock } from './hud/title-block.js';

export function start(root: HTMLElement = document.body): void {
  const store = new Store<EditorState>({ lang: initialLang(), status: 'connecting' });
  const connection = new Connection({ url: socketUrl(location), client: 'editor' });

  const openMap = (mapId: string): void => {
    if (store.state.mapId === mapId && connection.currentMap === mapId) return;
    store.set({ mapId, revision: undefined });
    const url = new URL(location.href);
    url.searchParams.set('map', mapId);
    history.replaceState(null, '', url);
    connection.openMap(mapId);
  };
  const setLang = (lang: Lang): void => {
    saveLang(lang);
    store.set({ lang });
  };

  connection.on('status', (status) => store.set({ status }));
  connection.on('welcome', (project) => {
    store.set({ project });
    const mapId = chooseMap(
      project,
      store.state.mapId ?? new URL(location.href).searchParams.get('map'),
    );
    if (mapId) openMap(mapId);
  });
  connection.on('message', (message) => {
    if (message.type === 'scene' && message.scene.map.id === store.state.mapId)
      store.set({ revision: message.scene.revision });
  });

  const titleBlock = new TitleBlock(store, { openMap, setLang });
  const hud = h('div', { class: 'hud' }, titleBlock.element);
  root.append(h('main', { class: 'editor' }, hud));

  const syncDocument = (state: EditorState) => {
    document.documentElement.lang = state.lang;
    document.title = state.project ? `${state.project.name} · mapedit` : 'mapedit';
  };
  store.subscribe(syncDocument);
  syncDocument(store.state);
  connection.start();
}
