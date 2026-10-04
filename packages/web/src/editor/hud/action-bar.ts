import { parseObjectRef } from '@mapedit/protocol';
import { h } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translate, type MessageKey, type Translator } from '../../i18n/i18n.js';
import type { SnapshotIndex } from '../../scene/snapshot-index.js';
import { describeObject } from '../describe.js';

/** One key hint: the keys (as keycaps) and what they do. */
export interface Hint {
  keys: (MessageKey | string)[];
  action: MessageKey;
}

/** Hints for the current selection; with nothing selected, how to look around. */
export function hintsFor(selection: string | undefined, index: SnapshotIndex | undefined): Hint[] {
  if (!selection || !index?.has(selection))
    return [
      { keys: ['key.click'], action: 'action.select' },
      { keys: ['key.rightDrag'], action: 'action.orbit' },
      { keys: ['key.middleDrag', 'key.wasd'], action: 'action.pan' },
      { keys: ['key.wheel'], action: 'action.zoom' },
      { keys: ['F'], action: 'action.wholeMap' },
    ];
  const hints: Hint[] = [];
  if (parseObjectRef(selection)?.kind === 'structure')
    hints.push({ keys: ['key.click'], action: 'action.selectModule' });
  hints.push({ keys: ['F'], action: 'action.focus' }, { keys: ['Esc'], action: 'action.deselect' });
  return hints;
}

/** Bottom-center bar, like a game hotbar: what is selected and which keys act on it. */
export class ActionBar {
  readonly element = h('section', { class: 'action-bar' });
  private readonly tag = h('div', { class: 'action-tag' });
  private readonly hints = h('ul', { class: 'action-hints' });

  constructor(
    store: Store<EditorState>,
    private readonly index: () => SnapshotIndex | undefined,
  ) {
    this.element.append(this.tag, this.hints);
    store.subscribe((state, previous) => {
      if (changed(state, previous, 'selection', 'lang', 'scene')) this.render(state);
    });
    this.render(store.state);
  }

  private render(state: EditorState): void {
    const t: Translator = (key, params) => translate(state.lang, key, params);
    const index = this.index();
    const description =
      state.selection && index ? describeObject(state.selection, index, t) : undefined;
    this.tag.hidden = !description;
    this.element.dataset.selected = String(Boolean(description));
    if (description)
      this.tag.replaceChildren(
        h('span', { class: 'action-kind', text: description.kind }),
        h('strong', { class: 'action-name', text: description.name }),
      );
    const label = (key: string) => (key.startsWith('key.') ? t(key as MessageKey) : key);
    this.hints.replaceChildren(
      ...hintsFor(state.selection, index).map((hint) =>
        h(
          'li',
          { class: 'action-hint' },
          ...hint.keys.map((key) => h('kbd', { text: label(key) })),
          h('span', { text: t(hint.action) }),
        ),
      ),
    );
  }
}
