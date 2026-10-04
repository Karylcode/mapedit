import type { NoticeCode, ObjectRef, ServerMessage } from '@mapedit/protocol';

export function noticeMessage(
  code: NoticeCode,
  message: string,
  refs?: ObjectRef[],
): Extract<ServerMessage, { type: 'notice' }> {
  return {
    type: 'notice',
    level: code === 'file_error' ? 'error' : 'warning',
    code,
    message,
    ...(refs ? { refs } : {}),
  };
}
