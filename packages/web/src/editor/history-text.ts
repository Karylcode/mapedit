import {
  parseObjectRef,
  type HistoryEntry,
  type ObjectRef,
  type ProjectInfo,
} from '@mapedit/protocol';
import { hasMessage, type Translator } from '../i18n/i18n.js';
import { idOf, type SnapshotIndex } from '../scene/snapshot-index.js';
import { objectName } from './describe.js';

/** An object by its own ids, for one on a map that is not drawn. */
function idsOf(ref: ObjectRef): string {
  const parsed = parseObjectRef(ref);
  return parsed?.kind === 'module' ? `${parsed.structureId} · ${parsed.instanceId}` : idOf(ref);
}

/**
 * One history row in the interface language, from the entry's action, refs,
 * maps and files. History covers every map of the project: an object on another
 * map is named by its ids and that map's name, never by the drawn map's object
 * with the same id. The English summary is shown as written only when nothing
 * else says what happened.
 */
export function describeEntry(
  entry: HistoryEntry,
  index: SnapshotIndex | undefined,
  t: Translator,
  project?: ProjectInfo,
): string {
  const drawn = index?.scene.map.id;
  const mapName = (id: string) => project?.maps.find((map) => map.id === id)?.name || id;
  const separator = t('list.separator');
  const ref = entry.refs?.[0];
  if ((entry.action === 'move' || entry.action === 'delete') && ref) {
    const elsewhere = entry.mapId !== undefined && entry.mapId !== drawn;
    const name = elsewhere
      ? t('notice.onMap', { objects: idsOf(ref), map: mapName(entry.mapId!) })
      : objectName(ref, index);
    return t(entry.action === 'move' ? 'history.move' : 'history.delete', { name });
  }
  if (entry.files.length) {
    const names = entry.files.map((file) => file.slice(file.lastIndexOf('/') + 1));
    const change =
      names.length <= 2
        ? t('history.files', { files: names.join(separator) })
        : t('history.moreFiles', {
            files: names.slice(0, 2).join(separator),
            count: names.length,
            more: names.length - 2,
          });
    const touched = (entry.maps ?? []).filter((map) => map.refs.length);
    const others = touched.filter((map) => map.mapId !== drawn).map((map) => mapName(map.mapId));
    if (!others.length) return change;
    const here = touched.length > others.length;
    return t(here ? 'history.alsoOnMaps' : 'history.onMaps', {
      change,
      maps: others.join(separator),
    });
  }
  return entry.summary;
}

/** Who made an entry; an author newer than this interface is shown as recorded. */
export function authorName(author: string, t: Translator): string {
  const key = `history.${author}`;
  return hasMessage(key) ? t(key) : author;
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
