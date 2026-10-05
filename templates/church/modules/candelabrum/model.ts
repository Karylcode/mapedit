import { material, revolve, translate } from '@mapedit/model';

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

// A tall turned candle stand with a candle on top.
const profile: Point[] = [
  [0, 0],
  [0.22, 0],
  [0.22, 0.06],
  [0.06, 0.14],
  [0.04, 1.5],
  [0.12, 1.55],
  [0.12, 1.62],
  [0.05, 1.62],
  [0.05, 1.95],
  [0, 1.95],
];
export default material('white', translate(revolve(ccw(profile), 16), [0.25, 0, 0.25]));
