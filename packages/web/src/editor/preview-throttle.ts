import type { Edit } from '@mapedit/protocol';

/**
 * Drag previews: at most one `previewEdit` in flight. While waiting for its
 * reply only the newest wanted edit is kept; older ones are simply dropped.
 * The owner calls `want` at most once per animation frame.
 */
export class PreviewThrottle {
  private inFlight?: number;
  private waiting?: Edit;
  private lastSent?: string;

  constructor(private readonly send: (edit: Edit) => number | undefined) {}

  /** Ask for a preview of `edit`; returns the request id if it was sent now. */
  want(edit: Edit): number | undefined {
    const key = JSON.stringify(edit);
    if (key === this.lastSent && this.inFlight === undefined) return undefined;
    if (this.inFlight !== undefined) {
      this.waiting = key === this.lastSent ? undefined : edit;
      return undefined;
    }
    return this.dispatch(edit, key);
  }

  /**
   * Note a reply. Returns true when it answers the request in flight; the
   * newest waiting edit, if any, is sent right away.
   */
  received(requestId: number): boolean {
    if (requestId !== this.inFlight) return false;
    this.inFlight = undefined;
    const next = this.waiting;
    this.waiting = undefined;
    if (next) this.dispatch(next, JSON.stringify(next));
    return true;
  }

  /** True while a sent preview has not been answered or a newer edit waits. */
  get busy(): boolean {
    return this.inFlight !== undefined || this.waiting !== undefined;
  }

  reset(): void {
    this.inFlight = this.waiting = this.lastSent = undefined;
  }

  private dispatch(edit: Edit, key: string): number | undefined {
    const id = this.send(edit);
    if (id === undefined) return undefined;
    this.inFlight = id;
    this.lastSent = key;
    return id;
  }
}
