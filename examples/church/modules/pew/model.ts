import { box, extrude, material, rotate, translate, union } from '@mapedit/model';

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

// A pew facing east (+X): carved ends, a seat, a back on the west side and a kneeler in front.
const end: Point[] = [
  [0, 0],
  [0.75, 0],
  [0.75, 0.55],
  [0.6, 0.62],
  [0.14, 0.62],
  [0.14, 0.95],
  [0.07, 1],
  [0, 1],
];
export default material(
  'white',
  union(
    slabXY(end, 0.08),
    translate(slabXY(end, 0.08), [0, 0, 2.92]),
    translate(box([0.62, 0.06, 2.84]), [0.1, 0.44, 0.08]),
    translate(box([0.08, 0.45, 2.84]), [0.03, 0.52, 0.08]),
    translate(box([0.05, 0.38, 2.84]), [0.03, 0.04, 0.08]),
    translate(box([0.15, 0.12, 2.84]), [0.82, 0.08, 0.08]),
  ),
);
