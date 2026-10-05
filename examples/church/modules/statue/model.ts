import { box, material, revolve, translate, union } from '@mapedit/model';

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

// A hooded knight on a plinth, facing +Z, both hands resting on the pommel of a sword
// planted point-down in front of it.
const robe = revolve(
  ccw([
    [0, 0.75],
    [0.36, 0.75],
    [0.3, 1.3],
    [0.22, 1.85],
    [0.29, 2.1],
    [0.33, 2.26],
    [0.2, 2.4],
    [0, 2.4],
  ]),
  16,
);
const hood = revolve(
  ccw([
    [0, 2.36],
    [0.17, 2.4],
    [0.2, 2.56],
    [0.15, 2.72],
    [0.06, 2.84],
    [0, 2.86],
  ]),
  12,
);
// Upper arms hang from the shoulders; forearms reach forward to the pommel.
const arm = (side: number) =>
  union(
    translate(box([0.13, 0.42, 0.14]), [0.5 + side * 0.3 - 0.065, 1.86, 0.43]),
    translate(box([0.13, 0.12, 0.38]), [0.5 + side * 0.2 - 0.065, 1.86, 0.55]),
  );
const sword = union(
  translate(box([0.09, 1.2, 0.03]), [0.455, 0.75, 0.86]),
  translate(box([0.42, 0.06, 0.07]), [0.29, 1.92, 0.84]),
  translate(box([0.05, 0.2, 0.05]), [0.475, 1.98, 0.85]),
  translate(box([0.3, 0.12, 0.1]), [0.35, 1.9, 0.82]),
);
export default material(
  'white',
  union(
    box([1, 0.6, 1]),
    translate(box([0.9, 0.15, 0.9]), [0.05, 0.6, 0.05]),
    translate(union(robe, hood), [0.5, 0, 0.5]),
    arm(-1),
    arm(1),
    sword,
  ),
);
