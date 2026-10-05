import { expect, it } from 'vitest';
import { BoxGeometry } from 'three';
import { outlineGeometry } from '../src/scene/toon.js';

it('gives every corner of a flat-shaded box one shared outward normal, so outlines close', () => {
  const box = new BoxGeometry(2, 2, 2);
  const hull = outlineGeometry(box);
  expect(outlineGeometry(box)).toBe(hull);
  expect(hull.getAttribute('position')).toBe(box.getAttribute('position'));
  const position = box.getAttribute('position');
  const normal = hull.getAttribute('outlineNormal');
  for (let i = 0; i < position.count; i++) {
    const expected = [position.getX(i), position.getY(i), position.getZ(i)].map(
      (n) => Math.sign(n) / Math.sqrt(3),
    );
    expect([normal.getX(i), normal.getY(i), normal.getZ(i)]).toEqual(
      expected.map((n) => expect.closeTo(n, 6)),
    );
  }
});
