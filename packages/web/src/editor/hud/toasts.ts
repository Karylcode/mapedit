import { h } from '../dom.js';

export type ToastLevel = 'info' | 'warning' | 'error';

export interface ToastInput {
  level: ToastLevel;
  text: string;
  /** Supporting text, such as the English message from the server. */
  detail?: string;
  /** A toast with the same key replaces the previous one instead of stacking. */
  key?: string;
  /** Seconds before it disappears; errors stay twice as long by default. */
  seconds?: number;
}

const DEFAULT_SECONDS: Record<ToastLevel, number> = { info: 4, warning: 7, error: 14 };
const LIMIT = 4;

/** Short messages near the top of the screen. */
export class Toasts {
  readonly element = h('section', { class: 'toasts', 'aria-live': 'polite' });
  private readonly timers = new Map<HTMLElement, number>();
  private dismissLabel = 'Dismiss';

  setDismissLabel(label: string): void {
    this.dismissLabel = label;
    for (const button of this.element.querySelectorAll('.toast-close'))
      button.setAttribute('aria-label', label);
  }

  show(input: ToastInput): HTMLElement {
    const existing = input.key
      ? [...this.element.children].find((child) => (child as HTMLElement).dataset.key === input.key)
      : undefined;
    if (existing) this.remove(existing as HTMLElement);
    const close = h('button', {
      type: 'button',
      class: 'toast-close',
      'aria-label': this.dismissLabel,
      text: '×',
    });
    const toast = h(
      'div',
      {
        class: 'toast',
        role: input.level === 'error' ? 'alert' : 'status',
        'data-level': input.level,
      },
      h('p', { class: 'toast-text', text: input.text }),
      input.detail ? h('p', { class: 'toast-detail', text: input.detail }) : null,
      close,
    );
    if (input.key) toast.dataset.key = input.key;
    close.addEventListener('click', () => this.remove(toast));
    this.element.prepend(toast);
    while (this.element.children.length > LIMIT)
      this.remove(this.element.lastElementChild as HTMLElement);
    const seconds = input.seconds ?? DEFAULT_SECONDS[input.level];
    this.timers.set(
      toast,
      window.setTimeout(() => this.remove(toast), seconds * 1000),
    );
    return toast;
  }

  /** Visible toast texts, newest first. */
  texts(): string[] {
    return [...this.element.querySelectorAll('.toast-text')].map((node) => node.textContent ?? '');
  }

  private remove(toast: HTMLElement): void {
    window.clearTimeout(this.timers.get(toast));
    this.timers.delete(toast);
    toast.remove();
  }
}
