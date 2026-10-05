import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import type { HistoryEntry } from '@mapedit/protocol';
import { describeEntry } from '../src/editor/history-text.js';
import { translate, type Translator } from '../src/i18n/i18n.js';
import { SnapshotIndex } from '../src/scene/snapshot-index.js';

const t: Translator = (key, params) => translate('en', key, params);
const index = new SnapshotIndex(mockScene());
const entry = (fields: Partial<HistoryEntry>): HistoryEntry => ({
  id: 1,
  author: 'human',
  time: '2026-10-05T00:00:00Z',
  summary: '',
  files: [],
  ...fields,
});

describe('history rows from structured fields (FE17)', () => {
  it('names a moved or deleted object from action and refs, whatever the summary says', () => {
    const moved = entry({ action: 'move', refs: ['structure:house'], summary: 'Relocated it' });
    expect(describeEntry(moved, index, t)).toBe('Moved House');
    const deleted = entry({ action: 'delete', refs: ['module:house/base'], summary: 'Gone' });
    expect(describeEntry(deleted, index, t)).toBe('Deleted House · base');
  });

  it('lists the files of an Agent change', () => {
    const changed = entry({
      author: 'agent',
      action: 'agent_change',
      refs: ['structure:house'],
      summary: 'Update project files',
      files: ['maps/village/structures/house.yaml'],
    });
    expect(describeEntry(changed, index, t)).toBe('Changed house.yaml');
  });

  it('shows a summary without an action as written, without parsing it', () => {
    expect(describeEntry(entry({ summary: 'Move structure:house' }), index, t)).toBe(
      'Move structure:house',
    );
  });
});

describe('history rows on more than one map (FE30)', () => {
  // The drawn map is the mock village; Second Map is another map of the project.
  const project = {
    name: 'Demo',
    maps: [
      { id: 'village', name: 'Mock village' },
      { id: 'second', name: 'Second Map' },
    ],
  };

  it('names an object moved on another map by its id and that map', () => {
    const moved = entry({ action: 'move', refs: ['structure:house'], mapId: 'second' });
    expect(describeEntry(moved, index, t, project)).toBe('Moved house on Second Map');
    const deleted = entry({ action: 'delete', refs: ['module:house/base'], mapId: 'second' });
    expect(describeEntry(deleted, index, t, project)).toBe('Deleted house · base on Second Map');
    // On the drawn map, as before.
    const here = entry({ action: 'move', refs: ['structure:house'], mapId: 'village' });
    expect(describeEntry(here, index, t, project)).toBe('Moved House');
  });

  it('says which other maps an Agent change touched', () => {
    const agent = (maps: { mapId: string; refs: string[] }[]) =>
      entry({
        author: 'agent',
        action: 'agent_change',
        refs: maps.flatMap((map) => map.refs),
        maps,
        files: maps.map((map) => `maps/${map.mapId}/structures/house.yaml`),
      });
    const both = agent([
      { mapId: 'village', refs: ['structure:house'] },
      { mapId: 'second', refs: ['structure:house'] },
    ]);
    expect(describeEntry(both, index, t, project)).toBe(
      'Changed house.yaml, house.yaml (also on Second Map)',
    );
    const elsewhere = agent([{ mapId: 'second', refs: ['structure:house'] }]);
    expect(describeEntry(elsewhere, index, t, project)).toBe('Changed house.yaml (on Second Map)');
    const zh: Translator = (key, params) => translate('zh-TW', key, params);
    expect(describeEntry(elsewhere, index, zh, project)).toBe(
      '改了 house.yaml（在「Second Map」）',
    );
    const here = agent([{ mapId: 'village', refs: ['structure:house'] }]);
    expect(describeEntry(here, index, t, project)).toBe('Changed house.yaml');
  });
});
