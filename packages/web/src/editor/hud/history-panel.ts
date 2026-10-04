import { h, setText } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translate, type Translator } from '../../i18n/i18n.js';
import type { SnapshotIndex } from '../../scene/snapshot-index.js';
import { authorName, describeEntry, entryTime } from '../history-text.js';

const OPEN_KEY = 'mapedit.historyOpen';

function remembered(): boolean | undefined {
  try {
    const value = globalThis.localStorage?.getItem(OPEN_KEY);
    return value === null || value === undefined ? undefined : value === 'true';
  } catch {
    return undefined;
  }
}

function remember(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(OPEN_KEY, String(open));
  } catch {
    // Only a convenience; the panel still toggles.
  }
}

/**
 * The project's change log: who changed what and when, newest first, with a
 * marker where undo and redo currently stand.
 */
export class HistoryPanel {
  readonly element = h('section', { class: 'history' });
  private readonly title = h('h2', { class: 'panel-title' });
  private readonly toggle = h('button', { type: 'button', class: 'panel-toggle' });
  private readonly undo = h('button', { type: 'button', class: 'chip-button' });
  private readonly redo = h('button', { type: 'button', class: 'chip-button' });
  private readonly list = h('ol', { class: 'history-list' });
  private open: boolean;

  constructor(
    private readonly store: Store<EditorState>,
    private readonly index: () => SnapshotIndex | undefined,
    actions: { undo(): void; redo(): void },
  ) {
    this.open = remembered() ?? globalThis.innerWidth > 720;
    this.undo.addEventListener('click', () => actions.undo());
    this.redo.addEventListener('click', () => actions.redo());
    this.toggle.addEventListener('click', () => {
      this.open = !this.open;
      remember(this.open);
      this.render(this.store.state);
    });
    this.element.append(
      h('header', { class: 'panel-header' }, this.toggle, this.title, this.undo, this.redo),
      this.list,
    );
    store.subscribe((state, previous) => {
      if (changed(state, previous, 'history', 'lang', 'scene')) this.render(state);
    });
    this.render(store.state);
  }

  private render(state: EditorState): void {
    const t: Translator = (key, params) => translate(state.lang, key, params);
    const { entries, cursor } = state.history;
    this.element.dataset.open = String(this.open);
    setText(this.title, t('history.title'));
    this.title.dataset.count = String(entries.length);
    this.toggle.setAttribute('aria-expanded', String(this.open));
    this.toggle.setAttribute('aria-label', t(this.open ? 'history.hide' : 'history.show'));
    this.undo.replaceChildren(h('kbd', { text: 'Ctrl+Z' }), t('action.undo'));
    this.redo.replaceChildren(h('kbd', { text: 'Ctrl+Y' }), t('action.redo'));
    this.undo.disabled = cursor <= 0;
    this.redo.disabled = cursor >= entries.length;
    this.list.hidden = !this.open;
    if (!this.open) return;
    const index = this.index();
    const rows: HTMLElement[] = [];
    const marker = h('li', { class: 'history-cursor', text: t('history.current') });
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (i === cursor - 1) rows.push(marker);
      const undone = i >= cursor;
      rows.push(
        h(
          'li',
          {
            class: 'history-entry',
            'data-author': entry.author,
            'data-undone': String(undone),
            title: undone ? t('history.undone') : '',
          },
          h('span', { class: 'history-author', text: authorName(entry.author, t) }),
          h('time', { class: 'history-time', text: entryTime(entry, state.lang) }),
          h('span', { class: 'history-summary', text: describeEntry(entry, index, t) }),
        ),
      );
    }
    if (cursor === 0) rows.push(marker);
    rows.push(
      h('li', {
        class: 'history-start',
        text: entries.length ? t('history.start') : t('history.empty'),
      }),
    );
    this.list.replaceChildren(...rows);
  }
}
