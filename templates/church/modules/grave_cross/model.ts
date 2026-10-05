import { box, material, translate, union } from '@mapedit/model';

export default material(
  'white',
  union(
    box([1, 0.25, 0.5]),
    translate(box([0.3, 1.75, 0.3]), [0.35, 0.25, 0.1]),
    translate(box([0.9, 0.25, 0.3]), [0.05, 1.35, 0.1]),
  ),
);
