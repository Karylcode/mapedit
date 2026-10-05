import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import {
  MAP_EDGES,
  MISSING_REFERENCE_REASONS,
  NOTICE_CODES,
  OFF_GRID_FIELDS,
  OVERLAP_TARGETS,
  ROTATION_FIELDS,
  SOCKET_PROBLEMS,
  VIOLATION_KINDS,
  type NoticeCode,
  type SceneSnapshot,
} from '@mapedit/protocol';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';
import { FileErrorFilter, noticeToast, type Notice } from '../src/editor/notices.js';
import { violationText } from '../src/editor/violations.js';
import { objectNames, wholeObjects } from '../src/editor/describe.js';
import { hasMessage, translate, type Translator, type Lang } from '../src/i18n/i18n.js';
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
    for (const lang of ['zh-TW', 'en'] as const)
      for (const code of NOTICE_CODES) {
        const toast = noticeToast(notice(code, ['structure:house']), index);
        const text = resolve(toast.text, tr(lang))!;
        expect(text, `${lang} ${code}`).not.toMatch(/\{|notice\.|English text/);
        if (code !== 'file_error' && code !== 'unknown_map') expect(text).toContain('House');
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

  it('remembers a file error by its whole message, without reading it (FE17)', () => {
    const filter = new FileErrorFilter();
    // Words the snapshot's file errors do not repeat.
    const message = 'Some project file is broken.';
    expect(filter.admit(message)).toBe(true);
    filter.update(mockScene());
    expect(filter.admit(message)).toBe(false);
  });
});

describe('notices about another map (FE17)', () => {
  const project = {
    name: 'Demo',
    maps: [
      { id: 'village', name: 'Mock village' },
      { id: 'second', name: 'Second Map' },
    ],
  };
  const on = (code: NoticeCode, refs: string[], mapId: string): Notice => ({
    ...notice(code, refs),
    mapId,
  });

  it('names objects from the open map only', () => {
    const here = noticeToast(on('agent_changed', ['module:house/base'], 'village'), index, project);
    expect(resolve(here.text, tr('en'))).toBe('The Agent changed House');
    const there = noticeToast(on('agent_changed', ['module:house/base'], 'second'), index, project);
    expect(resolve(there.text, tr('en'))).toBe('The Agent changed house on Second Map');
    expect(there.key).not.toBe(here.key);
  });

  it('says which map a lost edit was on', () => {
    const lost = noticeToast(
      on('overwritten_by_agent', ['structure:house'], 'second'),
      index,
      project,
    );
    expect(resolve(lost.text, tr('zh-TW'))).toBe(
      '你剛才對 「Second Map」上的 house 的修改，被 Agent 後來的修改蓋掉了',
    );
  });
});

describe('violation text', () => {
  it('translates every params value the protocol lists (FE21)', () => {
    // The English dictionary has the same keys as the Chinese one by type.
    const keys = [
      ...OFF_GRID_FIELDS.map((field) => `violation.field.${field}`),
      ...ROTATION_FIELDS.map((field) => `violation.rotationField.${field}`),
      ...MAP_EDGES.map((edge) => `direction.${edge}`),
      ...MISSING_REFERENCE_REASONS.map((reason) => `violation.missing.${reason}`),
      ...SOCKET_PROBLEMS.map((problem) => `violation.socket.${problem}`),
      ...OVERLAP_TARGETS.map((target) => `violation.overlap.${target}`),
    ];
    expect(keys.filter((key) => !hasMessage(key))).toEqual([]);
  });

  it('names every kind in both languages', () => {
    for (const kind of VIOLATION_KINDS) {
      const violation = { ...mockScene().violations[0]!, kind };
      // A missing name would fall back to the kind itself, such as off_grid.
      expect(violationText(violation, index, tr('zh-TW')).title).not.toMatch(/violation\.|_/);
      expect(violationText(violation, index, tr('en')).title).not.toMatch(/violation\.|_/);
      expect(violationText(violation, index, tr('en')).title).not.toBe(kind);
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

  it('tells apart structures that share a name and groups modules for notices', () => {
    const scene = mockScene();
    const copy = structuredClone(scene.structures[0]!);
    copy.ref = 'structure:house_two';
    copy.instances = [{ ...copy.instances[0]!, ref: 'module:house_two/base' }];
    scene.structures.push(copy);
    const twins = new SnapshotIndex(scene);
    expect(twins.structureName('structure:house')).toBe('House (house)');
    expect(twins.structureName('structure:house_two')).toBe('House (house_two)');
    expect(objectNames(['module:house/base', 'module:house_two/base'], twins, tr('en'))).toBe(
      'House (house) · base, House (house_two) · base',
    );
    expect(
      objectNames(['structure:house', 'module:house/base'], twins, tr('en'), { byStructure: true }),
    ).toBe('House (house)');
    expect(wholeObjects(['module:house/base', 'structure:house', 'marker:spawn'], twins)).toEqual([
      'structure:house',
      'marker:spawn',
    ]);
  });

  it('shortens long object lists', () => {
    const refs = ['structure:house', 'structure:overlap_a', 'structure:overlap_b', 'marker:zone'];
    expect(objectNames(refs, index, tr('zh-TW'))).toBe('House、overlap_a、overlap_b 等 4 個');
    expect(objectNames(refs, index, tr('en'))).toBe('House, overlap_a, overlap_b and 1 more');
    expect(objectNames(['structure:gone'], index, tr('en'))).toBe('gone');
  });
});
