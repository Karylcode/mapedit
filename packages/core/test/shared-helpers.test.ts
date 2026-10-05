import { expect, it } from 'vitest';
import { sceneHasProblems } from '../src/report.js';
import { supportedFrom } from '../src/support.js';
import {
  createTerrain,
  encodeTerrain,
  decodeTerrain,
  TERRAIN_HEIGHT_RANGE,
} from '../src/terrain.js';

it('F25 sceneHasProblems is the one rule for check, export and MCP ok', () => {
  const issue = { id: 'x', kind: 'overlap' as const, message: 'm', refs: [], params: {} };
  const fileError = { file: 'a.yaml', message: 'bad' };
  expect(sceneHasProblems({ violations: [], fileErrors: [] })).toBe(false);
  expect(sceneHasProblems({ violations: [issue], fileErrors: [] })).toBe(true);
  expect(sceneHasProblems({ violations: [], fileErrors: [fileError] })).toBe(true);
});

it('F25 supportedFrom spreads Support through links and honours the accepted set', () => {
  const links = new Map([
    ['ground', new Set(['wall'])],
    ['wall', new Set(['roof', 'ground'])],
    ['roof', new Set(['chimney'])],
  ]);
  expect([...supportedFrom(['ground'], links)].sort()).toEqual([
    'chimney',
    'ground',
    'roof',
    'wall',
  ]);
  expect([...supportedFrom(['ground'], links, (ref) => ref !== 'roof')].sort()).toEqual([
    'ground',
    'wall',
  ]);
  expect(supportedFrom([], links)).toEqual(new Set());
});

it('F25 TERRAIN_HEIGHT_RANGE matches what the height PNG can store', () => {
  const terrain = createTerrain(2, 1);
  terrain.heights.set([TERRAIN_HEIGHT_RANGE.min, TERRAIN_HEIGHT_RANGE.max]);
  const png = encodeTerrain(terrain);
  expect([...decodeTerrain(png.height, png.surface).heights]).toEqual([
    TERRAIN_HEIGHT_RANGE.min,
    TERRAIN_HEIGHT_RANGE.max,
  ]);
  terrain.heights[0] = TERRAIN_HEIGHT_RANGE.min - 0.5;
  expect(() => encodeTerrain(terrain)).toThrow();
});
