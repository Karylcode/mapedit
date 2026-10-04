import {
  parseObjectRef,
  type ObjectRef,
  type ProjectInfo,
  type SceneSnapshot,
  type ServerMessage,
} from '@mapedit/protocol';
import type { Translator } from '../i18n/i18n.js';
import type { SnapshotIndex } from '../scene/snapshot-index.js';
import { objectNames } from './describe.js';
import type { ToastInput } from './hud/toasts.js';

export type Notice = Extract<ServerMessage, { type: 'notice' }>;

/** A module counts as its structure, as in "the Agent changed a house". */
const ownerOf = (ref: ObjectRef): ObjectRef => {
  const parsed = parseObjectRef(ref);
  return parsed?.kind === 'module' ? `structure:${parsed.structureId}` : ref;
};

/**
 * True when a notice's refs belong to the drawn map. A notice names its map
 * when it has refs; one without a map is about this one.
 */
export function onDrawnMap(notice: Notice, index: SnapshotIndex | undefined): boolean {
  return notice.mapId === undefined || notice.mapId === index?.scene.map.id;
}

/**
 * The toast for a notice, in the interface language. The server's English
 * message is kept as detail where it says something the code does not.
 * Objects on another map are named by id with that map's name, since the
 * drawn map may have different objects with the same ids.
 */
export function noticeToast(
  notice: Notice,
  index: SnapshotIndex | undefined,
  project?: ProjectInfo,
): ToastInput {
  const refs = notice.refs ?? [];
  const here = onDrawnMap(notice, index);
  const map = project?.maps.find((m) => m.id === notice.mapId)?.name || notice.mapId;
  const objects = (t: Translator) =>
    here
      ? objectNames(refs, index, t, { byStructure: true })
      : t('notice.onMap', { objects: objectNames(refs.map(ownerOf), undefined, t), map: map! });
  const about = `${notice.mapId ?? ''}:${refs.join(',')}`;
  switch (notice.code) {
    case 'agent_changed':
      return {
        level: 'info',
        // One toast per map: a change to several maps sends a notice for each.
        key: `agent_changed:${notice.mapId ?? ''}`,
        text: (t) =>
          refs.length
            ? t('notice.agent_changed', { objects: objects(t) })
            : t('notice.agent_changed.files'),
        seconds: 3,
      };
    case 'overwritten_by_agent':
      return {
        level: 'warning',
        key: `overwritten:${about}`,
        text: (t) => t('notice.overwritten_by_agent', { objects: objects(t) }),
      };
    case 'agent_change_overridden':
      return {
        level: 'warning',
        key: `overridden:${about}`,
        text: (t) => t('notice.agent_change_overridden', { objects: objects(t) }),
      };
    case 'edit_rejected':
      // Shares its key with the editor's own result toast, so one rejection shows once.
      return {
        level: 'warning',
        key: `edit:${refs[0] ?? ''}`,
        text: (t) => t('notice.edit_rejected', { objects: objects(t) }),
        detail: notice.message,
      };
    case 'file_error':
      return {
        level: 'error',
        key: `file_error:${notice.message}`,
        text: (t) => t('notice.file_error'),
        detail: notice.message,
      };
    case 'unknown_map':
      return {
        level: 'error',
        key: `unknown_map:${notice.message}`,
        text: (t) => t('notice.unknown_map'),
        detail: notice.message,
      };
    default: {
      // A code newer than this interface: the server's English message says what happened.
      const { level, code, message } = notice as Notice;
      return { level, key: `notice:${code}:${message}`, text: message };
    }
  }
}

/**
 * The real server repeats a `file_error` notice for every unreadable file on
 * each rebuild. Each message is shown once while the project has file errors;
 * messages are compared whole and never read, and the issues panel lists the
 * errors that remain.
 */
export class FileErrorFilter {
  private readonly shown = new Set<string>();

  /** True when this message should be shown now. */
  admit(message: string): boolean {
    if (this.shown.has(message)) return false;
    this.shown.add(message);
    return true;
  }

  /** Once every file reads again, an error that comes back is shown again. */
  update(scene: SceneSnapshot): void {
    if (!scene.fileErrors.length) this.shown.clear();
  }
}
