import { box, difference, extrude, material, rotate, translate, union } from '@mapedit/model';

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

// A hollow square tower: corner pilasters, two string courses, a portal through the
// west and east faces, a window on every face and paired belfry openings at the top.
const hollow = translate(box([5, 24, 5]), [1.5, -1, 1.5]);
const pilasters = [0, 6.5].flatMap((x) =>
  [0, 6.5].map((z) => translate(box([1.5, 22, 1.5]), [x, 0, z])),
);
const bands = [7.5, 15, 21.5].map((y) => translate(box([8, 0.5, 8]), [0, y, 0]));
const body = difference(
  union(translate(box([7, 22, 7]), [0.5, 0, 0.5]), ...pilasters, ...bands),
  hollow,
);
const throughX = (outline: Point[], y: number, z: number) =>
  translate(slabZY(outline, 10), [-1, y, z]);
const throughZ = (outline: Point[], x: number, y: number) =>
  translate(slabXY(outline, 10), [x, y, -1]);
const openings = [
  throughX(arch(3, 4), 0, 2.5),
  throughX(arch(1.4, 2.5), 9.5, 3.3),
  throughZ(arch(1.4, 2.5), 3.3, 9.5),
  ...[2.2, 4.6].flatMap((o) => [
    throughX(arch(1.2, 2.2), 16.2, o),
    throughZ(arch(1.2, 2.2), o, 16.2),
  ]),
];
export default material('white', difference(body, ...openings));
