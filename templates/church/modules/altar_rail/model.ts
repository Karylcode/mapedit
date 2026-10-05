import { box, cylinder, material, translate, union } from '@mapedit/model';

// A communion rail: posts, a base, a top rail and a row of turned balusters.
const balusters = Array.from({ length: 9 }, (_, i) =>
  translate(cylinder(0.06, 0.76, 12), [0.25, 0.12, 0.3 + i * 0.3]),
);
export default material(
  'white',
  union(
    box([0.5, 0.12, 3]),
    translate(box([0.5, 0.12, 3]), [0, 0.88, 0]),
    box([0.5, 1, 0.15]),
    translate(box([0.5, 1, 0.15]), [0, 0, 2.85]),
    ...balusters,
  ),
);
