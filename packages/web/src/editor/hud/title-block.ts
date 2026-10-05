import { h, setText } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translator, LANGS, type Lang, type MessageKey } from '../../i18n/i18n.js';

/** What the title block asks the editor to do. */
export interface TitleActions {
  openMap(mapId: string): void;
  setLang(lang: Lang): void;
  /** Switch to another project of the projects folder. */
  openProject(projectId: string): void;
  /** Look the projects folder over again, for projects added since the page loaded. */
  refreshProjects(): void;
}

/**
 * Drawing-style title block: project, map, revision and live link, plus the
 * interface language. These are the facts a human checks before touching the map.
 * When the server serves a folder of projects, the project is a menu too.
 */
export class TitleBlock {
  readonly element: HTMLElement;
  private readonly project = h('span', { class: 'tb-value tb-project' });
  private readonly projectSelect = h('select', { class: 'tb-project-menu tb-project' });
  private readonly mapSelect = h('select', { class: 'tb-select' });
  private readonly revision = h('span', { class: 'tb-value tb-mono' });
  private readonly link = h('span', { class: 'tb-value tb-link' });
  private readonly labels: Record<string, HTMLElement> = {};
  private readonly langButtons = new Map<Lang, HTMLButtonElement>();

  constructor(
    private readonly store: Store<EditorState>,
    private readonly actions: TitleActions,
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
    this.projectSelect.addEventListener('change', () => {
      this.actions.openProject(this.projectSelect.value);
      this.projectSelect.blur();
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
      cell(
        'title.project',
        h('div', { class: 'tb-stack' }, this.project, this.projectSelect),
        'tb-wide',
      ),
      cell('title.revision', this.revision),
      cell('title.map', this.mapSelect, 'tb-wide'),
      cell('title.link', this.link),
      langSwitch,
    );
    // Projects the Agent created since the page loaded show up before the menu opens.
    this.projectSelect.parentElement!.addEventListener('pointerenter', () =>
      this.actions.refreshProjects(),
    );
    store.subscribe((state, previous) => this.render(state, previous));
    this.render(store.state);
  }

  private render(state: EditorState, previous?: EditorState): void {
    const t = translator(state.lang);
    if (!previous || changed(state, previous, 'lang')) {
      for (const [key, label] of Object.entries(this.labels)) setText(label, t(key as MessageKey));
      this.mapSelect.setAttribute('aria-label', t('title.switchMap'));
      this.projectSelect.setAttribute('aria-label', t('title.switchProject'));
      this.element.querySelector('.tb-lang')?.setAttribute('aria-label', t('lang.label'));
      for (const [lang, button] of this.langButtons) {
        setText(button, t(`lang.${lang}`));
        button.setAttribute('aria-pressed', String(lang === state.lang));
      }
    }
    setText(this.project, state.project?.name ?? '—');
    if (!previous || changed(state, previous, 'project', 'switchingProject'))
      this.renderProjects(state);
    if (!previous || changed(state, previous, 'project', 'mapId')) this.renderMaps(state);
    setText(this.revision, state.revision === undefined ? '—' : String(state.revision));
    setText(this.link, t(`status.${state.status}`));
    this.link.dataset.status = state.status;
  }

  private renderProjects(state: EditorState): void {
    const projects = state.project?.projects;
    const menu = projects !== undefined && projects.length > 0;
    this.projectSelect.hidden = !menu;
    this.project.hidden = menu;
    if (!menu) return;
    this.projectSelect.replaceChildren(
      ...projects.map((project) =>
        h('option', { text: project.name || project.id, 'data-id': project.id }),
      ),
    );
    for (const option of this.projectSelect.options) option.value = option.dataset.id ?? '';
    this.projectSelect.value = state.switchingProject ?? state.project?.id ?? '';
    this.projectSelect.disabled = projects.length < 2 || state.switchingProject !== undefined;
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
