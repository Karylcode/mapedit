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

/** A pointed arch `width` wide whose crown is `rise` above its springing, from y = −1. */
const pointed = (width: number, rise: number, steps = 12): Point[] => {
  const half = width / 2;
  const radius = (rise * rise + half * half) / (2 * half);
  const top = Math.acos((half - radius) / radius);
  const left: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - ((Math.PI - top) * i) / steps;
    left.push([radius + radius * Math.cos(a), radius * Math.sin(a)]);
  }
  const right = left
    .map(([x, y]): Point => [width - x, y])
    .reverse()
    .slice(1);
  return [[0, -1], ...left, ...right, [width, -1]];
};

// A groin vault under the nave roof: a pointed tunnel along the nave crossed by a
// pointed tunnel from each clerestory window. It springs from the vaulting shafts
// leaves half a transverse rib at each end.
const along = translate(slabZY(pointed(9, 4.6), 8), [-1, 0, 0.5]);
const across = translate(slabXY(pointed(5, 4.4), 12), [0.5, 0, -1]);
export default material('white', difference(box([6, 5, 10]), along, across));
