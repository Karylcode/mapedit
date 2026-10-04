import { parseObjectRef, type HistoryEntry } from '@mapedit/protocol';
import type { Translator } from '../i18n/i18n.js';
import { idOf, type SnapshotIndex } from '../scene/snapshot-index.js';

/** One history row in the interface language: what changed, by whom. */
export function describeEntry(
  entry: HistoryEntry,
  index: SnapshotIndex | undefined,
  t: Translator,
): string {
  // Human edits are recorded as "Move <ref>" or "Delete <ref>".
  const match = /^(Move|Delete) (\S+)$/.exec(entry.summary);
  if (match && parseObjectRef(match[2]!)) {
    const ref = match[2]!;
    const name = index?.has(ref) ? index.label(ref) : idOf(ref);
    return t(match[1] === 'Move' ? 'history.move' : 'history.delete', { name });
  }
  if (entry.files.length) {
    const names = entry.files.map((file) => file.slice(file.lastIndexOf('/') + 1));
    const separator = t('list.separator');
    if (names.length <= 2) return t('history.files', { files: names.join(separator) });
    return t('history.moreFiles', {
      files: names.slice(0, 2).join(separator),
      count: names.length,
      more: names.length - 2,
    });
  }
  return entry.summary;
}

/** Local wall-clock time of an entry, hours to seconds. */
export function entryTime(entry: HistoryEntry, lang: string): string {
  const time = new Date(entry.time);
  if (Number.isNaN(time.getTime())) return '';
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(time);
}
