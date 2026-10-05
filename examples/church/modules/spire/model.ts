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

// An octagonal spire with a pinnacle on each corner of the tower. The cross faces west,
// toward the main door, so it reads as a cross from the front of the church.
const spire = translate(
  rotate(
    revolve(
      ccw([
        [0, 0],
        [4, 0],
        [0, 15.5],
      ]),
      8,
    ),
    [0, 22.5, 0],
  ),
  [4.5, 0, 4.5],
);
const cross = union(
  translate(box([0.3, 2.5, 0.3]), [4.35, 15.2, 4.35]),
  translate(box([0.3, 0.3, 1.4]), [4.35, 16.6, 3.8]),
);
const pinnacle = (x: number, z: number) =>
  translate(
    revolve(
      ccw([
        [0, 0],
        [0.75, 0],
        [0, 3.5],
      ]),
      4,
    ),
    [x, 0, z],
  );
const pinnacles = [0.75, 8.25].flatMap((x) => [0.75, 8.25].map((z) => pinnacle(x, z)));
export default material('white', union(spire, cross, ...pinnacles));
