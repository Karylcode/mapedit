import { describe, expect, it } from 'vitest';
import { mockScene } from '@mapedit/server';
import { SnapshotIndex, idOf, violatingRefs } from '../src/scene/snapshot-index.js';

describe('SnapshotIndex', () => {
  const scene = mockScene();
  const index = new SnapshotIndex(scene);

  it('finds the structure of a structure or module ref', () => {
    expect(index.structureOf('structure:house')?.name).toBe('House');
    expect(index.structureOf('module:house/base')?.ref).toBe('structure:house');
    expect(index.structureOf('marker:spawn')).toBeUndefined();
    expect(index.has('marker:zone')).toBe(true);
    expect(index.has('structure:nowhere')).toBe(false);
  });

  it('expands a structure into the instances drawn for it', () => {
    expect(index.instancesOf('structure:overlap_a')).toEqual(['module:overlap_a/base']);
    expect(index.instancesOf('module:socket_b/base')).toEqual(['module:socket_b/base']);
    expect(index.instancesOf('marker:spawn')).toEqual([]);
  });

  it('labels objects by structure name, module type name, or id', () => {
    expect(index.label('structure:house')).toBe('House');
    expect(index.label('module:house/base')).toBe('Block');
    expect(index.label('module:missing_reference/base')).toBe('missing_block');
    expect(index.label('marker:zone')).toBe('zone');
    expect(idOf('module:house/base')).toBe('base');
    expect(idOf('not a ref')).toBe('not a ref');
  });

  it('collects every drawn object that a violation refers to', () => {
    const refs = violatingRefs(index, scene.violations);
    expect(refs).toContain('module:overlap_a/base');
    expect(refs).toContain('module:overlap_b/base');
    expect(refs).toContain('module:missing_reference/base');
    expect(refs).not.toContain('module:house/base');
    const markerViolation = { ...scene.violations[0]!, refs: ['marker:zone', 'structure:house'] };
    expect([...violatingRefs(index, [markerViolation])].sort()).toEqual([
      'marker:zone',
      'module:house/base',
    ]);
  });
});
