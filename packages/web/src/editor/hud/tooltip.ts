import { parseObjectRef } from '@mapedit/protocol';
import { h, setText } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translate, type Translator } from '../../i18n/i18n.js';
import type { SnapshotIndex } from '../../scene/snapshot-index.js';
import { describeObject, violationCount } from '../describe.js';

/** Name tag that follows the pointer over structures, modules and markers. */
export class Tooltip {
  readonly element = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
  private readonly kind = h('span', { class: 'tooltip-kind' });
  private readonly name = h('strong', { class: 'tooltip-name' });
  private readonly detail = h('span', { class: 'tooltip-detail' });
  private readonly hint = h('span', { class: 'tooltip-hint' });
  private readonly problems = h('span', { class: 'tooltip-problems' });

  constructor(
    store: Store<EditorState>,
    private readonly index: () => SnapshotIndex | undefined,
  ) {
    this.element.append(this.kind, this.name, this.detail, this.hint, this.problems);
    store.subscribe((state, previous) => {
      if (changed(state, previous, 'hover', 'lang', 'selection', 'scene')) this.render(state);
    });
  }

  private render(state: EditorState): void {
    const index = this.index();
    const hover = state.hover;
    const t: Translator = (key, params) => translate(state.lang, key, params);
    const description = hover && index ? describeObject(hover.ref, index, t) : undefined;
    this.element.hidden = !description;
    if (!hover || !index || !description) return;
    setText(this.kind, description.kind);
    setText(this.name, description.name);
    setText(this.detail, description.detail ?? '');
    this.detail.hidden = !description.detail;
    // Hovering a module of the selected structure: the next click picks just it.
    this.hint.hidden = !(
      parseObjectRef(hover.ref)?.kind === 'module' &&
      state.selection === index.structureOf(hover.ref)?.ref
    );
    setText(this.hint, t('hover.selectModule'));
    const count = violationCount(hover.ref, index);
    this.problems.hidden = count === 0;
    setText(this.problems, t('hover.violations', { count }));
    this.place(hover.x, hover.y);
  }

  private place(x: number, y: number): void {
    const { innerWidth, innerHeight } = window;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const left = x + 16 + width > innerWidth - 8 ? x - 12 - width : x + 16;
    const top = y + 20 + height > innerHeight - 8 ? y - 12 - height : y + 20;
    this.element.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }
}
