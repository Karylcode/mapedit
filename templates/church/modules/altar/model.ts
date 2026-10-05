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

// A stone altar with three blind lancet arches carved into each long face.
const body = translate(box([2.6, 0.8, 1.1]), [0.2, 0, 0.2]);
const blind = (x: number, z: number) => translate(slabXY(arch(0.5, 0.25, 6), 0.16), [x, 0.12, z]);
const arches = [0.55, 1.25, 1.95].flatMap((x) => [blind(x, 0.12), blind(x, 1.22)]);
export default material(
  'white',
  union(difference(body, ...arches), translate(box([3, 0.2, 1.5]), [0, 0.8, 0])),
);
