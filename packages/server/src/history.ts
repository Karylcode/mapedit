import type { EditFailure, HistoryEntry } from '@mapedit/protocol';

/** A refused edit, undo or redo: an English reason and its protocol failure code. */
export interface EditRefusal {
  reason: string;
  failure: EditFailure;
}

/** What a state store records; id and time are added by the history. */
export type RecordedChange = Omit<HistoryEntry, 'id' | 'time'>;

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

  record(entry: RecordedChange, snapshot: Snapshot): void {
    this.entries.splice(this.position);
    this.snapshots.splice(this.position + 1);
    this.entries.push({
      ...entry,
      files: [...entry.files],
      ...(entry.refs ? { refs: [...entry.refs] } : {}),
      ...(entry.maps
        ? { maps: entry.maps.map(({ mapId, refs }) => ({ mapId, refs: [...refs] })) }
        : {}),
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
  ): Promise<EditRefusal | undefined> {
    const cursor = this.position + direction;
    if (cursor < 0 || cursor > this.entries.length)
      return direction < 0
        ? { reason: 'Nothing to undo.', failure: 'nothing_to_undo' }
        : { reason: 'Nothing to redo.', failure: 'nothing_to_redo' };
    await restore(this.snapshots[cursor]!);
    this.position = cursor;
    return undefined;
  }
}
