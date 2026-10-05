import { difference, extrude, material, rotate, translate } from '@mapedit/model';

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

// The rounded east end of the nave: half of a regular octagon with an apothem of 6 m,
// open to the west, with a tall lancet in each of its three outer faces.
const side = (apothem: number) => apothem * Math.tan(Math.PI / 8);
const outer: Point[] = [
  [0, 0],
  [side(6), 0],
  [6, 6 - side(6)],
  [6, 6 + side(6)],
  [side(6), 12],
  [0, 12],
];
const inner: Point[] = [
  [-1, 1],
  [side(5), 1],
  [5, 6 - side(5)],
  [5, 6 + side(5)],
  [side(5), 11],
  [-1, 11],
];
const walls = difference(extrude(ccw(outer), 20), translate(extrude(ccw(inner), 22), [0, -1, 0]));
const lancet = translate(slabXY(arch(1.6, 8), 3), [-0.8, 4, -1.5]);
// The lancet turned so it crosses the face whose outward normal is at `angle`.
const window = (angle: number, x: number, z: number) =>
  translate(rotate(lancet, [0, angle, 0]), [x, 0, z]);
const mid = (6 + side(6)) / 2;
export default material(
  'white',
  difference(walls, window(90, 5.5, 6), window(135, mid, 6 - mid), window(45, mid, 6 + mid)),
);
