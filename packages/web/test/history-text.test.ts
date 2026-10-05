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
