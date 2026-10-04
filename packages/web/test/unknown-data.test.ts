import { describe, expect, it, vi } from 'vitest';
import { mockScene } from '@mapedit/server';
import { VIOLATION_KINDS, type ServerMessage, type ViolationView } from '@mapedit/protocol';
import { translate, type MessageKey, type Translator } from '../src/i18n/i18n.js';
import { violationText } from '../src/editor/violations.js';
import { noticeToast, type Notice } from '../src/editor/notices.js';
import { authorName } from '../src/editor/history-text.js';
import { Store } from '../src/editor/store.js';
import { Connection, type SocketLike } from '../src/net/connection.js';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';
import type { Localized } from '../src/editor/hud/toasts.js';

const t: Translator = (key, params) => translate('zh-TW', key, params);
const resolve = (value: Localized | undefined) => (typeof value === 'function' ? value(t) : value);

describe('data the interface does not know yet (FE13)', () => {
  it('shows a missing message key instead of throwing', () => {
    expect(translate('en', 'no.such.key' as MessageKey)).toBe('no.such.key');
  });

  it('names an unknown violation kind by itself and keeps the backend text', () => {
    const violation = {
      ...mockScene().violations[0]!,
      kind: 'leaky_roof',
      message: 'The roof leaks.',
      suggestion: 'Patch it.',
      params: {},
    } as unknown as ViolationView;
    expect(violationText(violation, new SnapshotIndex(mockScene()), t)).toMatchObject({
      title: 'leaky_roof',
      message: 'The roof leaks.',
      suggestion: 'Patch it.',
    });
  });

  it('shows the English message for an unknown notice code', () => {
    const notice = {
      type: 'notice',
      level: 'warning',
      code: 'brand_new',
      message: 'Something new happened.',
    } as unknown as Notice;
    const toast = noticeToast(notice, undefined);
    expect(toast.level).toBe('warning');
    expect(resolve(toast.text)).toBe('Something new happened.');
  });

  it('shows an unknown history author as written', () => {
    expect(authorName('robot', t)).toBe('robot');
    expect(authorName('human', t)).toBe('人');
  });

  it('translates every violation kind the protocol lists', () => {
    for (const kind of VIOLATION_KINDS) {
      const violation = { ...mockScene().violations[0]!, kind };
      expect(violationText(violation, undefined, t).title).not.toBe(kind);
    }
  });

  it('keeps notifying the other store listeners when one throws', () => {
    const store = new Store({ value: 1 });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: number[] = [];
    store.subscribe(() => {
      throw new Error('broken panel');
    });
    store.subscribe((state) => seen.push(state.value));
    expect(() => store.set({ value: 2 })).not.toThrow();
    expect(seen).toEqual([2]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('keeps delivering server messages to other listeners when one throws', () => {
    let socket!: SocketLike & { receive(data: string): void };
    const connection = new Connection({
      url: 'ws://test/ws',
      client: 'editor',
      createSocket: () => {
        socket = {
          readyState: 1,
          send() {},
          close() {},
          onopen: null,
          onclose: null,
          onmessage: null,
          onerror: null,
          receive(data: string) {
            this.onmessage?.({ data });
          },
        };
        return socket;
      },
      setTimer: () => 0,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const seen: string[] = [];
    connection.on('message', () => {
      throw new Error('broken view');
    });
    connection.on('message', (message: ServerMessage) => seen.push(message.type));
    connection.start();
    expect(() => socket.receive('{"type":"history","entries":[],"cursor":0}')).not.toThrow();
    expect(seen).toEqual(['history']);
    errors.mockRestore();
  });
});
