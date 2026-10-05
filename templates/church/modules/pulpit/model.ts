import {
  cylinder,
  difference,
  extrude,
  material,
  revolve,
  rotate,
  translate,
  union,
} from '@mapedit/model';

type Point = [number, number];

/** extrude wants counter-clockwise outlines. */
const ccw = (points: Point[]): Point[] => {
  let area = 0;
  points.forEach(([x1, z1], i) => {
    const [x2, z2] = points[(i + 1) % points.length]!;
    area += x1 * z2 - x2 * z1;
  });
  return area > 0 ? points : [...points].reverse();
};

/** A pointed (equilateral) gothic arch, `width` wide, with straight sides up to `spring`. */
const arch = (width: number, spring: number, steps = 8): Point[] => {
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI / 3) * (i / steps);
    left.push([width - width * Math.cos(a), spring + width * Math.sin(a)]);
    right.push([width * Math.cos(a), spring + width * Math.sin(a)]);
  }
  return [[0, 0], ...left, ...right.reverse().slice(1), [width, 0]];
};

/** An outline drawn in the XY plane, made solid from z = 0 to z = depth. */
const slabXY = (outline: Point[], depth: number) =>
  rotate(extrude(ccw(outline.map(([x, y]): Point => [x, -y])), depth), [90, 0, 0]);

/** An outline drawn in the ZY plane (first coordinate along +Z), solid from x = 0 to x = depth. */
const slabZY = (outline: Point[], depth: number) =>
  translate(rotate(slabXY(outline, depth), [0, -90, 0]), [depth, 0, 0]);

// An octagonal pulpit on a column, reached by steps from the west.
const cup = difference(
  revolve(
    ccw([
      [0, 1.9],
      [0.5, 1.9],
      [0.95, 2.35],
      [0.95, 3.3],
      [0, 3.3],
    ]),
    8,
  ),
  revolve(
    ccw([
      [0, 2.35],
      [0.82, 2.35],
      [0.82, 3.5],
      [0, 3.5],
    ]),
    8,
  ),
);
const stairs: Point[] = [
  [0, 0],
  [1.2, 0],
  [1.2, 2.35],
  [0.9, 2.35],
  [0.9, 1.8],
  [0.6, 1.8],
  [0.6, 1.2],
  [0.3, 1.2],
  [0.3, 0.6],
  [0, 0.6],
];
export default material(
  'white',
  union(
    translate(cylinder(0.3, 2, 16), [2, 0, 1]),
    translate(rotate(cup, [0, 22.5, 0]), [2, 0, 1]),
    translate(slabXY(stairs, 0.8), [0, 0, 0.6]),
  ),
);
