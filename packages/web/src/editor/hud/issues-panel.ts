import { h, setText } from '../dom.js';
import { changed, type Store } from '../store.js';
import type { EditorState } from '../state.js';
import { translate, type Translator } from '../../i18n/i18n.js';
import type { SnapshotIndex } from '../../scene/snapshot-index.js';
import { violationText } from '../violations.js';

const OPEN_KEY = 'mapedit.issuesOpen';

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
 * Violations and file errors, numbered like the flags on the map. Clicking a
 * violation flies to it and outlines the objects it names.
 */
export class IssuesPanel {
  readonly element = h('section', { class: 'issues' });
  private readonly title = h('h2', { class: 'panel-title' });
  private readonly errorCount = h('span', { class: 'issues-error-count' });
  private readonly toggle = h('button', { type: 'button', class: 'panel-toggle' });
  private readonly body = h('div', { class: 'issues-body' });
  private open: boolean;

  constructor(
    private readonly store: Store<EditorState>,
    private readonly index: () => SnapshotIndex | undefined,
    private readonly actions: { focusViolation(id: string): void },
  ) {
    this.open = remembered() ?? true;
    this.toggle.addEventListener('click', () => {
      this.open = !this.open;
      remember(this.open);
      this.render(this.store.state);
    });
    this.element.append(
      h('header', { class: 'panel-header' }, this.toggle, this.title, this.errorCount),
      this.body,
    );
    store.subscribe((state, previous) => {
      if (changed(state, previous, 'scene', 'lang', 'focusedViolation')) this.render(state);
    });
    this.render(store.state);
  }

  private render(state: EditorState): void {
    const t: Translator = (key, params) => translate(state.lang, key, params);
    const scene = state.scene;
    this.element.hidden = !scene;
    if (!scene) return;
    const violations = scene.violations;
    const fileErrors = scene.fileErrors;
    this.element.dataset.open = String(this.open);
    this.element.dataset.clean = String(violations.length + fileErrors.length === 0);
    setText(this.title, t('issues.title'));
    this.title.dataset.count = String(violations.length);
    setText(
      this.errorCount,
      fileErrors.length ? `${t('issues.fileErrors')} ${fileErrors.length}` : '',
    );
    this.errorCount.hidden = fileErrors.length === 0;
    this.toggle.setAttribute('aria-expanded', String(this.open));
    this.toggle.setAttribute('aria-label', t(this.open ? 'issues.hide' : 'issues.show'));
    this.body.hidden = !this.open;
    if (!this.open) return;
    const index = this.index();
    const rows: HTMLElement[] = violations.map((violation, i) => {
      const text = violationText(violation, index, t);
      const item = h(
        'button',
        {
          type: 'button',
          class: 'issue',
          'data-kind': violation.kind,
          'aria-pressed': String(state.focusedViolation === violation.id),
        },
        h('span', { class: 'issue-number', text: String(i + 1) }),
        h(
          'span',
          { class: 'issue-main' },
          h(
            'span',
            { class: 'issue-title' },
            h('strong', { text: text.title }),
            ` · ${text.objects}`,
          ),
          h('span', { class: 'issue-message', text: text.message }),
          text.suggestion
            ? h(
                'span',
                { class: 'issue-suggestion' },
                h('em', { text: t('issues.suggestion') }),
                text.suggestion,
              )
            : null,
          text.source ? h('code', { class: 'issue-source', text: text.source }) : null,
        ),
      );
      item.addEventListener('click', () => this.actions.focusViolation(violation.id));
      return item;
    });
    if (fileErrors.length)
      rows.push(
        h('h3', { class: 'issues-subtitle', text: t('issues.fileErrors') }),
        ...fileErrors.map((error) =>
          h(
            'div',
            { class: 'file-error' },
            h('code', {
              class: 'issue-source',
              text: error.line === undefined ? error.file : `${error.file}:${error.line}`,
            }),
            h('span', { class: 'issue-message', text: error.message }),
          ),
        ),
      );
    if (!rows.length) rows.push(h('p', { class: 'issues-none', text: t('issues.none') }));
    this.body.replaceChildren(...rows);
  }
}
