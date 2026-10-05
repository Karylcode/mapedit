import {
  box,
  cylinder,
  difference,
  extrude,
  material,
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

// The main front between the towers: a stepped pointed portal, a rose window with
// tracery, a lancet in the gable and a cross on the apex facing west.
const gable: Point[] = [
  [0, 0],
  [12, 0],
  [12, 20],
  [6, 30],
  [0, 20],
];
/** A disc facing west, `depth` thick from x = 0, centred on y = 0, z = 0. */
const disc = (radius: number, depth: number) =>
  translate(rotate(cylinder(radius, depth, 32), [0, 0, 90]), [depth, 0, 0]);
const portal = [
  translate(slabZY(arch(4, 4.5), 4), [-1, 0, 4]),
  translate(slabZY(arch(5.2, 4.3), 0.9), [-0.1, 0, 3.4]),
  translate(slabZY(arch(6.4, 4.1), 0.5), [-0.1, 0, 2.8]),
];
const rose = [translate(disc(3, 0.6), [-0.1, 15, 6]), translate(disc(2.2, 4), [-1, 15, 6])];
const lancet = translate(slabZY(arch(1, 2), 4), [-1, 22, 5.5]);
const bar = (angle: number) =>
  translate(rotate(translate(box([0.4, 4.4, 0.3]), [0, -2.2, -0.15]), [angle, 0, 0]), [0.8, 15, 6]);
const tracery = [0, 45, 90, 135].map(bar);
const cross = union(
  translate(box([0.3, 3.2, 0.3]), [0.85, 29.7, 5.85]),
  translate(box([0.3, 0.3, 1.6]), [0.85, 31.6, 5.2]),
);
export default material(
  'white',
  union(difference(slabZY(gable, 2), ...portal, ...rose, lancet), ...tracery, cross),
);
