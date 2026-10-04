import type { HistoryEntry } from '@mapedit/protocol';

/** Shared linear history; each state store supplies its own immutable checkpoint. */
export class ProjectHistory<Snapshot> {
  readonly entries: HistoryEntry[] = [];
  private position = 0;
  private nextId = 1;
  private readonly snapshots: Snapshot[];

  constructor(initial: Snapshot) {
    this.snapshots = [initial];
  }

  /** Number of entries in effect; undo moves it back, redo forward. */
  get cursor(): number {
    return this.position;
  }

  record(entry: Pick<HistoryEntry, 'author' | 'summary' | 'files'>, snapshot: Snapshot): void {
    this.entries.splice(this.position);
    this.snapshots.splice(this.position + 1);
    this.entries.push({
      ...entry,
      files: [...entry.files],
      id: this.nextId++,
      time: new Date().toISOString(),
    });
    this.snapshots.push(snapshot);
    this.position = this.entries.length;
  }

  /**
   * Undo (-1) or redo (1): `restore` brings the project to the target checkpoint, and the
   * cursor moves only after it succeeds. Returns the reason when there is nothing to do.
   */
  async travel(
    direction: -1 | 1,
    restore: (snapshot: Snapshot) => void | Promise<void>,
  ): Promise<string | undefined> {
    const cursor = this.position + direction;
    if (cursor < 0 || cursor > this.entries.length)
      return direction < 0 ? 'Nothing to undo.' : 'Nothing to redo.';
    await restore(this.snapshots[cursor]!);
    this.position = cursor;
    return undefined;
  }
}
