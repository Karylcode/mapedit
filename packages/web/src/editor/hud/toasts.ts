import { h } from '../dom.js';
import type { Translator } from '../../i18n/i18n.js';

export type ToastLevel = 'info' | 'warning' | 'error';

/** Text in the interface language, recomputed when the language changes. */
export type Localized = string | ((t: Translator) => string);

export interface ToastInput {
  level: ToastLevel;
  text: Localized;
  /** Supporting text, such as the English message from the server. */
  detail?: Localized;
  /** A toast with the same key replaces the previous one instead of stacking. */
  key?: string;
  /** Seconds before it disappears; errors stay longer by default. */
  seconds?: number;
}

const DEFAULT_SECONDS: Record<ToastLevel, number> = { info: 4, warning: 7, error: 14 };
const LIMIT = 4;

interface Shown {
  input: ToastInput;
  text: HTMLElement;
  detail?: HTMLElement;
  close: HTMLElement;
  timer: number;
}

/** Short messages near the top of the screen. */
export class Toasts {
  readonly element = h('section', { class: 'toasts', 'aria-live': 'polite' });
  private readonly shown = new Map<HTMLElement, Shown>();

  constructor(private t: Translator) {}

  /** Switch language; visible toasts are rewritten too. */
  setTranslator(t: Translator): void {
    this.t = t;
    for (const shown of this.shown.values()) this.fill(shown);
  }

  show(input: ToastInput): HTMLElement {
    if (input.key)
      for (const [element, shown] of this.shown)
        if (shown.input.key === input.key) this.remove(element);
    const text = h('p', { class: 'toast-text' });
    const detail = input.detail ? h('p', { class: 'toast-detail' }) : undefined;
    const close = h('button', { type: 'button', class: 'toast-close', text: '×' });
    const toast = h(
      'div',
      {
        class: 'toast',
        role: input.level === 'error' ? 'alert' : 'status',
        'data-level': input.level,
      },
      text,
      detail,
      close,
    );
    if (input.key) toast.dataset.key = input.key;
    close.addEventListener('click', () => this.remove(toast));
    const seconds = input.seconds ?? DEFAULT_SECONDS[input.level];
    const shown: Shown = {
      input,
      text,
      detail,
      close,
      timer: window.setTimeout(() => this.remove(toast), seconds * 1000),
    };
    this.shown.set(toast, shown);
    this.fill(shown);
    this.element.prepend(toast);
    while (this.element.children.length > LIMIT)
      this.remove(this.element.lastElementChild as HTMLElement);
    return toast;
  }

  /** Visible toast texts, newest first. */
  texts(): string[] {
    return [...this.element.querySelectorAll('.toast-text')].map((node) => node.textContent ?? '');
  }

  private fill(shown: Shown): void {
    const resolve = (value: Localized) => (typeof value === 'function' ? value(this.t) : value);
    shown.text.textContent = resolve(shown.input.text);
    if (shown.detail && shown.input.detail) shown.detail.textContent = resolve(shown.input.detail);
    shown.close.setAttribute('aria-label', this.t('notice.dismiss'));
  }

  private remove(toast: HTMLElement): void {
    const shown = this.shown.get(toast);
    if (shown) window.clearTimeout(shown.timer);
    this.shown.delete(toast);
    toast.remove();
  }
}
