import type { ServerMessage, SceneSnapshot } from '@mapedit/protocol';
import type { SnapshotIndex } from '../scene/snapshot-index.js';
import { objectNames } from './describe.js';
import type { ToastInput } from './hud/toasts.js';

export type Notice = Extract<ServerMessage, { type: 'notice' }>;

/**
 * The toast for a notice, in the interface language. The server's English
 * message is kept as detail where it says something the code does not.
 */
export function noticeToast(notice: Notice, index: SnapshotIndex | undefined): ToastInput {
  const refs = notice.refs ?? [];
  const objects = (t: Parameters<typeof objectNames>[2]) => objectNames(refs, index, t);
  switch (notice.code) {
    case 'agent_changed':
      return {
        level: 'info',
        key: 'agent_changed',
        text: (t) =>
          refs.length
            ? t('notice.agent_changed', { objects: objects(t) })
            : t('notice.agent_changed.files'),
        seconds: 3,
      };
    case 'overwritten_by_agent':
      return {
        level: 'warning',
        key: `overwritten:${refs.join(',')}`,
        text: (t) => t('notice.overwritten_by_agent', { objects: objects(t) }),
      };
    case 'agent_change_overridden':
      return {
        level: 'warning',
        key: `overridden:${refs.join(',')}`,
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
  }
}

/**
 * The real server repeats a `file_error` notice for every unreadable file on
 * each rebuild. Each message is shown once while its error persists.
 */
export class FileErrorFilter {
  private readonly shown = new Set<string>();

  /** True when this message should be shown now. */
  admit(message: string): boolean {
    if (this.shown.has(message)) return false;
    this.shown.add(message);
    return true;
  }

  /** Forget messages whose errors are gone, so they are shown again if they come back. */
  update(scene: SceneSnapshot): void {
    for (const message of this.shown)
      if (!scene.fileErrors.some((error) => message.includes(error.message)))
        this.shown.delete(message);
  }
}
