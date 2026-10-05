import { h, setText } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translator, LANGS, type Lang, type MessageKey } from '../../i18n/i18n.js';

/**
 * Drawing-style title block: project, map, revision and live link, plus the
 * interface language. These are the facts a human checks before touching the map.
 */
export class TitleBlock {
  readonly element: HTMLElement;
  private readonly project = h('span', { class: 'tb-value tb-project' });
  private readonly mapSelect = h('select', { class: 'tb-select' });
  private readonly revision = h('span', { class: 'tb-value tb-mono' });
  private readonly link = h('span', { class: 'tb-value tb-link' });
  private readonly labels: Record<string, HTMLElement> = {};
  private readonly langButtons = new Map<Lang, HTMLButtonElement>();

  constructor(
    private readonly store: Store<EditorState>,
    private readonly actions: { openMap(mapId: string): void; setLang(lang: Lang): void },
  ) {
    const cell = (key: string, value: HTMLElement, extra = '') => {
      const label = h('span', { class: 'tb-label' });
      this.labels[key] = label;
      return h('div', { class: `tb-cell ${extra}` }, label, value);
    };
    this.mapSelect.addEventListener('change', () => {
      this.actions.openMap(this.mapSelect.value);
      // Hand the keyboard back to the map: arrows and WASD move the camera, not the choice.
      this.mapSelect.blur();
    });
    const langSwitch = h('div', { class: 'tb-lang', role: 'group' });
    for (const lang of LANGS) {
      const button = h('button', { type: 'button', class: 'tb-lang-option', lang });
      button.addEventListener('click', () => this.actions.setLang(lang));
      this.langButtons.set(lang, button);
      langSwitch.append(button);
    }
    this.element = h(
      'header',
      { class: 'title-block' },
      cell('title.project', this.project, 'tb-wide'),
      cell('title.revision', this.revision),
      cell('title.map', this.mapSelect, 'tb-wide'),
      cell('title.link', this.link),
      langSwitch,
    );
    store.subscribe((state, previous) => this.render(state, previous));
    this.render(store.state);
  }

  private render(state: EditorState, previous?: EditorState): void {
    const t = translator(state.lang);
    if (!previous || changed(state, previous, 'lang')) {
      for (const [key, label] of Object.entries(this.labels)) setText(label, t(key as MessageKey));
      this.mapSelect.setAttribute('aria-label', t('title.switchMap'));
      this.element.querySelector('.tb-lang')?.setAttribute('aria-label', t('lang.label'));
      for (const [lang, button] of this.langButtons) {
        setText(button, t(`lang.${lang}`));
        button.setAttribute('aria-pressed', String(lang === state.lang));
      }
    }
    setText(this.project, state.project?.name ?? '—');
    if (!previous || changed(state, previous, 'project', 'mapId')) this.renderMaps(state);
    setText(this.revision, state.revision === undefined ? '—' : String(state.revision));
    setText(this.link, t(`status.${state.status}`));
    this.link.dataset.status = state.status;
  }

  private renderMaps(state: EditorState): void {
    const maps = state.project?.maps ?? [];
    this.mapSelect.replaceChildren(
      ...maps.map((map) => h('option', { text: map.name || map.id, 'data-id': map.id })),
    );
    for (const option of this.mapSelect.options) option.value = option.dataset.id ?? '';
    this.mapSelect.value = state.mapId ?? '';
    this.mapSelect.disabled = maps.length < 2;
  }
}
