import { expect, it } from 'vitest';
import { NOTICE_CODES } from '@mapedit/protocol';
import { TERRAIN_HEIGHT_RANGE } from '@mapedit/core';
import { selectedMapIds } from '../src/build-project.js';
import { terrainCommandSchema } from '../src/mcp-inputs.js';
import { parseMockNotice } from '../src/mock-services.js';

it('F25 selectedMapIds is the one map selection for CLI builds and MCP reports', () => {
  const info = {
    name: 'Maps',
    maps: [
      { id: 'b_town', name: 'B' },
      { id: 'a_field', name: 'A' },
    ],
  };
  expect(selectedMapIds(info)).toEqual(['a_field', 'b_town']);
  expect(selectedMapIds(info, 'b_town')).toEqual(['b_town']);
  expect(selectedMapIds({ name: 'Empty', maps: [] })).toEqual([undefined]);
});

it('F25 MCP terrain inputs use the terrain height range', () => {
  const region = { kind: 'circle', center: [1, 1], radius: 1 };
  const setHeight = (height: number) =>
    terrainCommandSchema.safeParse({ operation: 'set_height', region, height }).success;
  expect(setHeight(TERRAIN_HEIGHT_RANGE.max)).toBe(true);
  expect(setHeight(TERRAIN_HEIGHT_RANGE.min)).toBe(true);
  expect(setHeight(TERRAIN_HEIGHT_RANGE.max + 0.5)).toBe(false);
  const raise = (amount: number) =>
    terrainCommandSchema.safeParse({ operation: 'raise', region, amount }).success;
  expect(raise(TERRAIN_HEIGHT_RANGE.max - TERRAIN_HEIGHT_RANGE.min)).toBe(true);
  expect(raise(TERRAIN_HEIGHT_RANGE.max - TERRAIN_HEIGHT_RANGE.min + 0.5)).toBe(false);
});

it('F25 the mock trigger accepts exactly the protocol notice codes', () => {
  for (const code of NOTICE_CODES) expect(parseMockNotice({ notice: code })).toBe(code);
  expect(() => parseMockNotice({ notice: 'teleported' })).toThrow('known notice code');
});
