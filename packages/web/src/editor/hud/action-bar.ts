import { parseObjectRef } from '@mapedit/protocol';
import { h } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translator, type MessageKey } from '../../i18n/i18n.js';
import type { SnapshotIndex } from '../../scene/snapshot-index.js';
import { describeObject } from '../describe.js';

/** One key hint: the keys (as keycaps) and what they do. */
export interface Hint {
  keys: (MessageKey | string)[];
  action: MessageKey;
}

/** First-person mode: how to fly and how to get back. */
const FLYING: Hint[] = [
  { keys: ['key.mouse'], action: 'action.look' },
  { keys: ['key.wasd'], action: 'action.fly' },
  { keys: ['key.space'], action: 'action.rise' },
  { keys: ['Shift'], action: 'action.sink' },
  { keys: ['key.wheel'], action: 'action.flySpeed' },
  { keys: ['Esc', 'V'], action: 'action.leaveFirstPerson' },
];

/**
 * Hints for the current selection; with nothing selected, how to look around;
 * in first-person mode, how to fly.
 */
export function hintsFor(
  selection: string | undefined,
  index: SnapshotIndex | undefined,
  firstPerson = false,
): Hint[] {
  if (firstPerson) return FLYING;
  if (!selection || !index?.has(selection))
    return [
      { keys: ['key.click'], action: 'action.select' },
      { keys: ['key.rightDrag'], action: 'action.orbit' },
      { keys: ['key.middleDrag', 'key.wasd'], action: 'action.pan' },
      { keys: ['key.wheel'], action: 'action.zoom' },
      { keys: ['F'], action: 'action.wholeMap' },
      { keys: ['V'], action: 'action.firstPerson' },
    ];
  const kind = parseObjectRef(selection)?.kind;
  const hints: Hint[] =
    kind === 'module'
      ? [
          { keys: ['Del'], action: 'action.deleteModule' },
          { keys: ['key.drag'], action: 'action.moveStructure' },
          { keys: ['R'], action: 'action.rotateStructure' },
        ]
      : [
          { keys: ['key.drag'], action: 'action.move' },
          { keys: ['R'], action: 'action.rotate' },
          { keys: ['Del'], action: 'action.delete' },
        ];
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
      if (changed(state, previous, 'selection', 'lang', 'scene', 'firstPerson')) this.render(state);
    });
    this.render(store.state);
  }

  private render(state: EditorState): void {
    const t = translator(state.lang);
    const index = this.index();
    const description =
      state.selection && index && !state.firstPerson
        ? describeObject(state.selection, index, t)
        : undefined;
    this.tag.hidden = !description;
    this.element.dataset.selected = String(Boolean(description));
    if (description)
      this.tag.replaceChildren(
        h('span', { class: 'action-kind', text: description.kind }),
        h('strong', { class: 'action-name', text: description.name }),
      );
    const label = (key: string) => (key.startsWith('key.') ? t(key as MessageKey) : key);
    this.hints.replaceChildren(
      ...hintsFor(state.selection, index, state.firstPerson).map((hint) =>
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
