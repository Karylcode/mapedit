import { describe, expect, it } from 'vitest';
import { markerRef, moduleRef, parseObjectRef, structureRef } from '../src/index.js';

describe('ObjectRef helpers', () => {
  it('round-trips all three placed-object kinds without confusing source and root Structures', () => {
    expect(structureRef('House_1')).toBe('structure:House_1');
    expect(parseObjectRef(structureRef('House_1'))).toEqual({
      kind: 'structure',
      structureId: 'House_1',
    });
    expect(moduleRef('annex-2', 'floor_1')).toBe('module:annex-2/floor_1');
    expect(parseObjectRef(moduleRef('annex-2', 'floor_1'))).toEqual({
      kind: 'module',
      structureId: 'annex-2',
      instanceId: 'floor_1',
    });
    expect(markerRef('spawn')).toBe('marker:spawn');
    expect(parseObjectRef(markerRef('spawn'))).toEqual({ kind: 'marker', markerId: 'spawn' });
  });
  it.each([
    '',
    'house',
    'structure:',
    'structure:house/extra',
    'module:house',
    'module:house/base.east',
    'module:house/base/extra',
    'moduleType:block',
    'marker:spawn ',
    'structure:9house',
    'marker:出生',
    'structure:house\n',
    'structure:house\r',
    'structure:house\r\n',
    'module:house/base\n',
    'marker:spawn\r',
  ])('rejects an incomplete or non-object reference: %s', (ref) => {
    expect(parseObjectRef(ref)).toBeUndefined();
  });
  it.each([
    '',
    '9house',
    'house/base',
    'house.east',
    'house:other',
    'house ',
    'house\n',
    'house\r',
    'house\r\n',
  ])('rejects an invalid identifier in every constructor: %s', (id) => {
    expect(() => structureRef(id)).toThrow('Invalid object id');
    expect(() => markerRef(id)).toThrow('Invalid object id');
    expect(() => moduleRef(id, 'base')).toThrow('Invalid object id');
    expect(() => moduleRef('house', id)).toThrow('Invalid object id');
  });
});
