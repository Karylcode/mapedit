import { h, setText } from '../dom.js';

/** A red tag next to the pointer saying why a dragged object cannot be placed. */
export class CursorNote {
  readonly element = h('div', { class: 'cursor-note', role: 'status', hidden: true });
  private readonly title = h('strong', { class: 'cursor-note-title' });
  private readonly detail = h('span', { class: 'cursor-note-detail' });

  constructor() {
    this.element.append(this.title, this.detail);
  }

  show(title: string, detail: string | undefined, x: number, y: number): void {
    setText(this.title, title);
    setText(this.detail, detail ?? '');
    this.detail.hidden = !detail;
    this.element.hidden = false;
    this.move(x, y);
  }

  move(x: number, y: number): void {
    if (this.element.hidden) return;
    const width = this.element.offsetWidth;
    const left = x + 18 + width > window.innerWidth - 8 ? x - 14 - width : x + 18;
    this.element.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, y + 16)}px)`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  get visible(): boolean {
    return !this.element.hidden;
  }
}
