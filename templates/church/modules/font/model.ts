import { difference, material, revolve, rotate, translate } from '@mapedit/model';

type Point = [number, number];

/** extrude and revolve want counter-clockwise outlines. */
const ccw = (points: Point[]): Point[] => {
  let area = 0;
  points.forEach(([x1, z1], i) => {
    const [x2, z2] = points[(i + 1) % points.length]!;
    area += x1 * z2 - x2 * z1;
  });
  return area > 0 ? points : [...points].reverse();
};

// An octagonal stone font: a base, a narrow stem and a wide hollow bowl.
const outer = revolve(
  ccw([
    [0, 0],
    [0.8, 0],
    [0.8, 0.2],
    [0.35, 0.35],
    [0.3, 0.8],
    [0.85, 1],
    [0.95, 1.45],
    [0, 1.45],
  ]),
  8,
);
const bowl = revolve(
  ccw([
    [0, 1.15],
    [0.75, 1.15],
    [0.83, 1.6],
    [0, 1.6],
  ]),
  8,
);
export default material(
  'white',
  translate(rotate(difference(outer, bowl), [0, 22.5, 0]), [1, 0, 1]),
);
