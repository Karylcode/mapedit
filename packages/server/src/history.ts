import type { HistoryEntry } from '@mapedit/protocol';

/** Shared linear history; each state store supplies its own immutable checkpoint. */
export class ProjectHistory<Snapshot> {
  readonly entries: HistoryEntry[] = [];
  cursor = 0;
  private nextId = 1;
  private readonly snapshots: Snapshot[];

  constructor(initial: Snapshot) {
    this.snapshots = [initial];
  }

  record(entry: Pick<HistoryEntry, 'author' | 'summary' | 'files'>, snapshot: Snapshot): void {
    this.entries.splice(this.cursor);
    this.snapshots.splice(this.cursor + 1);
    this.entries.push({
      ...entry,
      files: [...entry.files],
      id: this.nextId++,
      time: new Date().toISOString(),
    });
    this.snapshots.push(snapshot);
    this.cursor = this.entries.length;
  }

  target(direction: -1 | 1): { cursor: number; snapshot: Snapshot } | undefined {
    const cursor = this.cursor + direction;
    if (cursor < 0 || cursor > this.entries.length) return undefined;
    return { cursor, snapshot: this.snapshots[cursor]! };
  }
}
