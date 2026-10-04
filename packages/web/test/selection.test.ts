import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import type { SceneSnapshot } from '@mapedit/protocol';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';
import { clickSelection, keepSelection, movableOf } from '../src/editor/selection.js';
import { describeObject, violationCount } from '../src/editor/describe.js';
import { hintsFor } from '../src/editor/hud/action-bar.js';
import { translate, type Translator } from '../src/i18n/i18n.js';

/** The mock house with a second module, so module selection has a choice. */
function scene(): SceneSnapshot {
  const value = mockScene();
  const house = value.structures[0]!;
  house.instances.push({ ...house.instances[0]!, ref: 'module:house/roof' });
  return value;
}

const t: Translator = (key, params) => translate('en', key, params);

describe('click selection', () => {
  const index = new SnapshotIndex(scene());

  it('selects the whole structure first, then a single module of it', () => {
    const first = clickSelection(undefined, 'module:house/base', index);
    expect(first).toBe('structure:house');
    const second = clickSelection(first, 'module:house/base', index);
    expect(second).toBe('module:house/base');
    expect(clickSelection(second, 'module:house/roof', index)).toBe('module:house/roof');
    expect(clickSelection(second, 'module:house/base', index)).toBe('module:house/base');
  });

  it('goes back to the whole structure when clicking another structure', () => {
    expect(clickSelection('module:house/base', 'module:overlap_a/base', index)).toBe(
      'structure:overlap_a',
    );
    expect(clickSelection('marker:spawn', 'module:house/base', index)).toBe('structure:house');
  });

  it('selects markers directly and clears on empty ground', () => {
    expect(clickSelection('structure:house', 'marker:zone', index)).toBe('marker:zone');
    expect(clickSelection('structure:house', undefined, index)).toBeUndefined();
    expect(clickSelection(undefined, 'module:gone/base', index)).toBeUndefined();
  });

  it('drops a selection the Agent deleted and finds what moves', () => {
    expect(keepSelection('module:house/roof', index)).toBe('module:house/roof');
    expect(keepSelection('structure:gone', index)).toBeUndefined();
    expect(movableOf('module:house/roof', index)).toBe('structure:house');
    expect(movableOf('marker:spawn', index)).toBe('marker:spawn');
  });
});

describe('object descriptions', () => {
  const index = new SnapshotIndex(scene());

  it('names structures, modules and markers for the tooltip and action bar', () => {
    expect(describeObject('structure:house', index, t)).toEqual({
      kind: 'Structure',
      name: 'House',
      detail: 'house · 2 modules',
    });
    expect(describeObject('module:house/roof', index, t)).toEqual({
      kind: 'Module',
      name: 'Block',
      detail: 'House · roof',
    });
    expect(describeObject('marker:spawn', index, t)).toEqual({
      kind: 'Spawn point',
      name: 'spawn',
    });
    expect(translate('zh-TW', 'marker.type.trigger')).toBe('觸發區');
    expect(describeObject('structure:none', index, t)).toBeUndefined();
  });

  it('counts violations through structures and modules', () => {
    expect(violationCount('structure:overlap_a', index)).toBe(1);
    expect(violationCount('module:overlap_b/base', index)).toBe(1);
    expect(violationCount('structure:house', index)).toBe(0);
  });

  it('shows navigation hints with nothing selected and actions for a selection', () => {
    expect(hintsFor(undefined, index).map((h) => h.action)).toEqual([
      'action.select',
      'action.orbit',
      'action.pan',
      'action.zoom',
      'action.wholeMap',
    ]);
    expect(hintsFor('structure:house', index).map((h) => h.action)).toEqual([
      'action.move',
      'action.rotate',
      'action.delete',
      'action.focus',
      'action.deselect',
    ]);
    expect(hintsFor('module:house/base', index).map((h) => h.action)).toEqual([
      'action.deleteModule',
      'action.moveStructure',
      'action.rotateStructure',
      'action.focus',
      'action.deselect',
    ]);
  });
});
