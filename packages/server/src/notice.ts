import type { NoticeCode, ObjectRef, ServerMessage } from '@mapedit/protocol';

/** A map id that is not in the project; answered with the unknown_map notice and never built. */
export class UnknownMapError extends Error {
  constructor(readonly mapId: string) {
    super(`Map "${mapId}" does not exist. Choose a map listed in project information.`);
    this.name = 'UnknownMapError';
  }
}

/** `mapId` names the map that holds `refs` (protocol section 4). */
export function noticeMessage(
  code: NoticeCode,
  message: string,
  refs?: ObjectRef[],
  mapId?: string,
): Extract<ServerMessage, { type: 'notice' }> {
  return {
    type: 'notice',
    level: code === 'file_error' || code === 'unknown_map' ? 'error' : 'warning',
    code,
    message,
    ...(refs ? { refs } : {}),
    ...(mapId !== undefined ? { mapId } : {}),
  };
}
