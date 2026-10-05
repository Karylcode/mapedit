import { box, cylinder, material, translate, union } from '@mapedit/model';

// A cluster of three slender shafts against the nave wall (local z = 0), carrying the vault.
const shaft = (x: number, z: number, radius: number) =>
  translate(cylinder(radius, 13.6, 16), [x, 0.4, z]);
export default material(
  'white',
  union(
    box([1, 0.4, 0.5]),
    shaft(0.5, 0.25, 0.22),
    shaft(0.15, 0.15, 0.12),
    shaft(0.85, 0.15, 0.12),
    translate(box([0.8, 0.2, 0.4]), [0.1, 14, 0]),
    translate(box([1, 0.3, 0.5]), [0, 14.2, 0]),
  ),
);
