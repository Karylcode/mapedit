import { describe, expect, it } from 'vitest';
import { createViolation } from '../src/violation.js';

describe('F16 shared violation construction', () => {
  it('keeps stable identity separate from message, source metadata, location and ref order', () => {
    const before = createViolation({
      kind: 'overlap',
      message: 'Before',
      refs: ['module:alpha/base', 'module:beta/base'],
      source: { file: 'structures.yaml', line: 3 },
      params: { volume: 1 },
      location: [1, 2, 3],
      suggestion: 'Move west.',
      rule: 'physical',
    });
    const after = createViolation({
      kind: 'overlap',
      message: 'After',
      refs: ['module:beta/base', 'module:alpha/base'],
      source: { file: 'structures.yaml', line: 8 },
      params: { volume: 2 },
      location: [4, 5, 6],
      suggestion: 'Move east.',
      rule: 'physical',
    });
    expect(before.id).toBe(after.id);
    expect(before).toMatchObject({
      params: { file: 'structures.yaml', line: 3, volume: 1 },
      location: [1, 2, 3],
      suggestion: 'Move west.',
    });
    expect(after.refs).toEqual(['module:beta/base', 'module:alpha/base']);
    expect(
      createViolation({ kind: 'overlap', message: 'Terrain', refs: before.refs, rule: 'terrain' })
        .id,
    ).not.toBe(before.id);
  });
  it('preserves existing params precedence and owns a mutable view of readonly refs', () => {
    const refs = Object.freeze(['module:house/base']);
    const violation = createViolation({
      kind: 'unsupported',
      message: 'No Support',
      refs,
      source: { file: 'original.yaml', line: 1 },
      params: { file: 'specific.yaml', line: 7 },
    });
    expect(violation.params).toEqual({ file: 'specific.yaml', line: 7 });
    violation.refs.push('structure:house');
    expect(refs).toEqual(['module:house/base']);
    expect(violation).not.toHaveProperty('location');
    expect(violation).not.toHaveProperty('suggestion');
  });
  it('does not add absent source metadata to diagnostics without a file', () => {
    expect(
      createViolation({ kind: 'missing_reference', message: 'Missing', refs: [] }).params,
    ).toEqual({});
  });
});
