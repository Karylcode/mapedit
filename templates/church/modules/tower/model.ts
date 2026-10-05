import { box, difference, extrude, material, rotate, translate } from '@mapedit/model';

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

// One of the two west towers: 2 m walls around a hollow shaft, recessed panels between
// corner pilasters on the west and north faces (the faces left open to view), tall
// lancets, paired belfry openings, and a side door. Turn it 90 degrees for the south tower.
const hollow = translate(box([5, 34, 5]), [2, -1, 2]);
const stories: Point[] = [
  [0.5, 9.5],
  [10.5, 20.5],
  [21.5, 31],
];
const panels = stories.flatMap(([from, to]) => [
  translate(box([0.5, to - from, 6]), [-0.1, from, 1.5]),
  translate(box([6, to - from, 0.5]), [1.5, from, -0.1]),
]);
const throughX = (outline: Point[], y: number, z: number) =>
  translate(slabZY(outline, 11), [-1, y, z]);
const throughZ = (outline: Point[], x: number, y: number) =>
  translate(slabXY(outline, 11), [x, y, -1]);
const openings = [
  translate(slabZY(arch(2.4, 3.2), 3), [-1, 0, 3.3]),
  throughX(arch(1.6, 4), 12, 3.7),
  throughZ(arch(1.6, 4), 3.7, 12),
  ...[2.6, 5.1].flatMap((o) => [throughX(arch(1.3, 3), 22.5, o), throughZ(arch(1.3, 3), o, 22.5)]),
];
export default material('white', difference(box([9, 32, 9]), hollow, ...panels, ...openings));
