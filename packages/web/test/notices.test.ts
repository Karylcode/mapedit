import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import type { NoticeCode, SceneSnapshot } from '@mapedit/protocol';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';
import { FileErrorFilter, noticeToast, type Notice } from '../src/editor/notices.js';
import { violationText, VIOLATION_KINDS } from '../src/editor/violations.js';
import { objectNames } from '../src/editor/describe.js';
import { translate, type Translator, type Lang } from '../src/i18n/i18n.js';
import type { Localized } from '../src/editor/hud/toasts.js';

const index = new SnapshotIndex(mockScene());
const tr =
  (lang: Lang): Translator =>
  (key, params) =>
    translate(lang, key, params);
const resolve = (value: Localized | undefined, t: Translator) =>
  typeof value === 'function' ? value(t) : value;
const notice = (code: NoticeCode, refs?: string[], message = 'English text'): Notice => ({
  type: 'notice',
  level: 'warning',
  code,
  message,
  ...(refs ? { refs } : {}),
});

describe('notice toasts', () => {
  it('translates every notice code in both languages', () => {
    const codes: NoticeCode[] = [
      'agent_changed',
      'overwritten_by_agent',
      'agent_change_overridden',
      'edit_rejected',
      'file_error',
    ];
    for (const lang of ['zh-TW', 'en'] as const)
      for (const code of codes) {
        const toast = noticeToast(notice(code, ['structure:house']), index);
        const text = resolve(toast.text, tr(lang))!;
        expect(text, `${lang} ${code}`).not.toMatch(/\{|notice\./);
        if (code !== 'file_error') expect(text).toContain('House');
      }
    expect(
      resolve(noticeToast(notice('agent_changed', ['structure:house']), index).text, tr('zh-TW')),
    ).toBe('Agent 修改了 House');
    expect(resolve(noticeToast(notice('agent_changed', []), index).text, tr('en'))).toBe(
      'The Agent changed project files',
    );
  });

  it('keeps the English detail where it adds information and shares keys with edit results', () => {
    const rejected = noticeToast(notice('edit_rejected', ['structure:house'], 'Overlaps x'), index);
    expect(rejected.key).toBe('edit:structure:house');
    expect(rejected.detail).toBe('Overlaps x');
    const file = noticeToast(notice('file_error', undefined, 'a.yaml:2: bad'), index);
    expect(file.level).toBe('error');
    expect(file.detail).toBe('a.yaml:2: bad');
  });

  it('shows a repeated file error once until it is fixed', () => {
    const filter = new FileErrorFilter();
    const scene: SceneSnapshot = mockScene();
    const message = `${scene.fileErrors[0]!.file}:2: ${scene.fileErrors[0]!.message}`;
    expect(filter.admit(message)).toBe(true);
    filter.update(scene);
    expect(filter.admit(message)).toBe(false);
    filter.update({ ...scene, fileErrors: [] });
    expect(filter.admit(message)).toBe(true);
  });
});

describe('violation text', () => {
  it('names every kind in both languages', () => {
    for (const kind of VIOLATION_KINDS) {
      const violation = { ...mockScene().violations[0]!, kind };
      expect(violationText(violation, index, tr('zh-TW')).title).not.toMatch(/violation\./);
      expect(violationText(violation, index, tr('en')).title).not.toMatch(/violation\./);
    }
  });

  it('translates the message from params and keeps other advice and the source line', () => {
    const overlap = mockScene().violations.find((v) => v.kind === 'overlap')!;
    expect(violationText(overlap, index, tr('zh-TW'))).toEqual({
      title: '穿模',
      objects: 'overlap_a · base、overlap_b · base',
      message: '兩個模組互相重疊',
      suggestion: overlap.suggestion,
      source: 'maps/village/structures/overlap_a.yaml:3',
    });
  });

  it('translates every kind of mock violation from its params in both languages', () => {
    const text = (kind: string, lang: Lang) =>
      violationText(
        mockScene().violations.find((v) => v.kind === kind)!,
        index,
        tr(lang),
      );
    expect(text('off_grid', 'zh-TW')).toMatchObject({
      message: '結構位置 (60.25, 10) 不在 0.5 公尺的格子上',
      suggestion: '改成 (60.5, 10)',
    });
    expect(text('bad_rotation', 'en')).toMatchObject({
      message: 'Structure rotation 7° is not a multiple of 15°',
      suggestion: 'Use 0°',
    });
    expect(text('out_of_bounds', 'zh-TW')).toMatchObject({
      message: '超出地圖東邊 1 公尺',
      suggestion: '往西移 1 公尺，就會回到地圖裡',
    });
    expect(text('out_of_bounds', 'en')).toMatchObject({
      message: 'Sticks out 1 m past the east edge',
      suggestion: 'Move it 1 m west to fit inside the map',
    });
    expect(text('missing_reference', 'zh-TW').message).toBe('找不到模組 missing_block');
    expect(text('incompatible_socket', 'zh-TW').message).toBe(
      '插槽類型 roof 和 stair 不能接在一起',
    );
    expect(text('unsupported', 'en').message).toBe(
      'Nothing holds it up all the way down to the ground',
    );
  });

  it('falls back to the backend text when params do not match the protocol', () => {
    const odd = {
      ...mockScene().violations[0]!,
      kind: 'off_grid' as const,
      params: { values: 'x' },
    };
    expect(violationText(odd, index, tr('zh-TW')).message).toBe(odd.message);
  });

  it('shortens long object lists', () => {
    const refs = ['structure:house', 'structure:overlap_a', 'structure:overlap_b', 'marker:zone'];
    expect(objectNames(refs, index, tr('zh-TW'))).toBe('House、overlap_a、overlap_b 等 4 個');
    expect(objectNames(refs, index, tr('en'))).toBe('House, overlap_a, overlap_b and 1 more');
    expect(objectNames(['structure:gone'], index, tr('en'))).toBe('gone');
  });
});
