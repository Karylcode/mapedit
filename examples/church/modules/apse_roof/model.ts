import { box, intersection, material, revolve, rotate, translate } from '@mapedit/model';

type Point = [number, number];

/** revolve wants counter-clockwise profiles. */
const ccw = (points: Point[]): Point[] => {
  let area = 0;
  points.forEach(([x1, z1], i) => {
    const [x2, z2] = points[(i + 1) % points.length]!;
    area += x1 * z2 - x2 * z1;
  });
  return area > 0 ? points : [...points].reverse();
};

// Half of an octagonal pyramid over the apse; its apex meets the nave ridge.
const apothem = 6;
const cone = revolve(
  ccw([
    [0, 0],
    [apothem / Math.cos(Math.PI / 8), 0],
    [0, 7],
  ]),
  8,
);
export default material(
  'white',
  intersection(translate(rotate(cone, [0, 22.5, 0]), [0, 0, 6]), box([6, 7, 12])),
);
