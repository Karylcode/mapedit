import { h, setText } from '../dom.js';
import type { Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translator } from '../../i18n/i18n.js';

/** What the page is waiting for, if anything: the server, a map, or its models. */
export function statusMessage(state: EditorState): string | undefined {
  const t = translator(state.lang);
  if (state.status === 'incompatible') return t('status.incompatible');
  if (state.switchingProject !== undefined) {
    const project = state.project?.projects?.find((p) => p.id === state.switchingProject);
    return t('loading.project', { name: project?.name || state.switchingProject });
  }
  if (!state.project) return t('loading.server');
  if (state.project.maps.length === 0) return t('loading.noMaps');
  if (state.loadingMap) {
    const map = state.project.maps.find((m) => m.id === state.mapId);
    return t('loading.map', { name: map?.name || state.mapId || '' });
  }
  return undefined;
}

export class StatusCard {
  readonly element: HTMLElement;
  private readonly message = h('p', { class: 'status-message' });
  private readonly meter = h('div', { class: 'status-meter', role: 'progressbar' });
  private readonly fill = h('div', { class: 'status-meter-fill' });
  private readonly count = h('p', { class: 'status-count' });

  constructor(store: Store<EditorState>) {
    this.meter.append(this.fill);
    this.element = h(
      'section',
      { class: 'status-card', 'aria-live': 'polite' },
      this.message,
      this.meter,
      this.count,
    );
    store.subscribe((state) => this.render(state));
    this.render(store.state);
  }

  private render(state: EditorState): void {
    const message = statusMessage(state);
    this.element.hidden = message === undefined;
    if (message === undefined) return;
    setText(this.message, message);
    const { loaded, total } = state.progress;
    const showMeter = state.loadingMap && state.scene !== undefined && total > 0;
    this.meter.hidden = this.count.hidden = !showMeter;
    if (showMeter) {
      this.fill.style.width = `${(100 * loaded) / total}%`;
      this.meter.setAttribute('aria-valuenow', String(Math.round((100 * loaded) / total)));
      setText(this.count, translator(state.lang)('loading.models', { loaded, total }));
    }
  }
}
