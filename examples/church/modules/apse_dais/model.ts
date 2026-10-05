import { extrude, material } from '@mapedit/model';

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

// The apse floor, raised to the chancel level: the apse's inner half-octagon, kept clear
// of the vaulting shafts at its west edge.
const side = 5 * Math.tan(Math.PI / 8);
const outline: Point[] = [
  [0.5, 0],
  [side, 0],
  [5, 5 - side],
  [5, 5 + side],
  [side, 10],
  [0.5, 10],
];
export default material('white', extrude(ccw(outline), 1));
