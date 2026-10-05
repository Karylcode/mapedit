import { box, material, revolve, rotate, translate, union } from '@mapedit/model';

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

// Crowns the bell tower: an octagonal spire with a cross, and a pinnacle on each corner pilaster.
const spire = translate(
  rotate(
    revolve(
      ccw([
        [0, 0],
        [3.5, 0],
        [0, 12.5],
      ]),
      8,
    ),
    [0, 22.5, 0],
  ),
  [4, 0, 4],
);
const cross = union(
  translate(box([0.2, 1.5, 0.2]), [3.9, 12.3, 3.9]),
  translate(box([0.9, 0.2, 0.2]), [3.55, 13.1, 3.9]),
);
const pinnacle = (x: number, z: number) =>
  translate(
    revolve(
      ccw([
        [0, 0],
        [0.75, 0],
        [0, 3],
      ]),
      4,
    ),
    [x, 0, z],
  );
const pinnacles = [0.75, 7.25].flatMap((x) => [0.75, 7.25].map((z) => pinnacle(x, z)));
export default material('white', union(spire, cross, ...pinnacles));
