import { expect, it } from 'vitest';
import { markerPosition } from '../src/index.js';

it('reads the actual point position and box center without changing their height convention', () => {
  expect(markerPosition({ kind: 'point', position: [4, 2, 6], rotation: 90 })).toEqual([4, 2, 6]);
  expect(markerPosition({ kind: 'box', center: [4, 3, 6], size: [2, 2, 2], rotation: 90 })).toEqual(
    [4, 3, 6],
  );
});
