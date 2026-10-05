import { cylinder, material, revolve, translate, union } from '@mapedit/model';

type Point = [number, number];
/** A ball of `radius` centred `height` above the ground, as a revolve profile. */
const ball = (radius: number, height: number, steps = 8): Point[] => {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    points.push([
      Math.abs(radius * Math.cos(a)) < 1e-9 ? 0 : radius * Math.cos(a),
      height + radius * Math.sin(a),
    ]);
  }
  return points;
};
const trunk = translate(cylinder(0.35, 4.5, 12), [2, 0, 2]);
const crown = union(
  translate(revolve(ball(1.9, 5.3), 12), [2, 0, 2]),
  translate(revolve(ball(1.2, 6.8), 12), [2, 0, 2]),
);
export default material('white', union(trunk, crown));
