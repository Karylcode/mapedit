import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import type { Edit, HistoryEntry } from '@mapedit/protocol';
import { PreviewThrottle } from '../src/editor/preview-throttle.js';
import { normalizeAngle, turnAbout, turnXZ, yawOf } from '../src/editor/move-math.js';
import { describeEntry, entryTime } from '../src/editor/history-text.js';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';
import { translate, type Translator } from '../src/i18n/i18n.js';

const move = (x: number): Edit => ({
  kind: 'move',
  ref: 'structure:house',
  position: [x, 0, 0],
  rotation: 0,
});

describe('PreviewThrottle', () => {
  it('keeps one preview in flight and only the newest waiting edit', () => {
    const sent: Edit[] = [];
    const throttle = new PreviewThrottle((edit) => (sent.push(edit), sent.length));
    expect(throttle.want(move(1))).toBe(1);
    // Three frames pass while the backend is busy: only the last is kept.
    throttle.want(move(2));
    throttle.want(move(3));
    throttle.want(move(4));
    expect(sent).toEqual([move(1)]);
    expect(throttle.busy).toBe(true);
    expect(throttle.received(1)).toBe(true);
    expect(sent).toEqual([move(1), move(4)]);
    expect(throttle.received(1)).toBe(false);
    expect(throttle.received(2)).toBe(true);
    expect(throttle.busy).toBe(false);
  });

  it('does not resend an unchanged edit, and ignores stale replies', () => {
    const sent: Edit[] = [];
    const throttle = new PreviewThrottle((edit) => (sent.push(edit), sent.length));
    throttle.want(move(1));
    throttle.received(1);
    expect(throttle.want(move(1))).toBeUndefined();
    throttle.want(move(2));
    // The pointer comes back while waiting: the waiting edit equals the one in flight.
    throttle.want(move(2));
    expect(throttle.received(99)).toBe(false);
    throttle.received(2);
    expect(sent).toEqual([move(1), move(2)]);
  });

  it('sends nothing while offline and starts over after reset', () => {
    let online = false;
    const sent: Edit[] = [];
    const throttle = new PreviewThrottle((edit) =>
      online ? (sent.push(edit), sent.length) : undefined,
    );
    expect(throttle.want(move(1))).toBeUndefined();
    expect(throttle.busy).toBe(false);
    online = true;
    throttle.want(move(1));
    throttle.reset();
    expect(throttle.want(move(1))).toBe(2);
  });
});

describe('rotation math', () => {
  it('reads the yaw of a transform counterclockwise from above', () => {
    const scene = mockScene();
    expect(yawOf(scene.structures[0]!.transform)).toBe(0);
    const turned = scene.structures.find((s) => s.ref === 'structure:bad_rotation')!;
    expect(yawOf(turned.transform)).toBe(7);
    expect(normalizeAngle(-15)).toBe(345);
    expect(normalizeAngle(720)).toBe(0);
  });

  it('turns offsets and origins about a pivot', () => {
    const [x, z] = turnXZ(1, 0, 90);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(-1); // east turns to north
    const origin = turnAbout([10, 3, 10], [12, 0, 12], 180);
    expect(origin[0]).toBeCloseTo(14);
    expect(origin[1]).toBe(3);
    expect(origin[2]).toBeCloseTo(14);
  });
});

describe('change log text', () => {
  const index = new SnapshotIndex(mockScene());
  const t: Translator = (key, params) => translate('zh-TW', key, params);
  const entry = (summary: string, files: string[] = []): HistoryEntry => ({
    id: 1,
    author: 'human',
    time: '2026-10-05T03:04:05.000Z',
    summary,
    files,
  });

  it('describes human moves and deletes by object name', () => {
    expect(describeEntry(entry('Move structure:house'), index, t)).toBe('移動 House');
    expect(describeEntry(entry('Delete marker:zone'), index, t)).toBe('刪除 zone');
    expect(describeEntry(entry('Delete structure:gone'), index, t)).toBe('刪除 gone');
  });

  it('describes Agent changes by the files they touched', () => {
    const one = entry('Update project files', ['maps/village/structures/house.yaml']);
    expect(describeEntry(one, index, t)).toBe('改了 house.yaml');
    const many = entry('Update project files', ['a/one.yaml', 'b/two.yaml', 'c/three.png']);
    expect(describeEntry(many, index, t)).toBe('one.yaml、two.yaml 等 3 個檔案');
    const en: Translator = (key, params) => translate('en', key, params);
    expect(describeEntry(many, index, en)).toBe('one.yaml, two.yaml and 1 more file');
    expect(describeEntry(entry('Something else'), index, t)).toBe('Something else');
  });

  it('shows local wall-clock time', () => {
    expect(entryTime(entry('x'), 'en')).toMatch(/^\d\d:\d\d:05$/);
    expect(entryTime({ ...entry('x'), time: 'not a date' }, 'en')).toBe('');
  });
});
