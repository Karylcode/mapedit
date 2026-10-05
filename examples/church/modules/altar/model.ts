import { box, material, translate, union } from '@mapedit/model';

export default material(
  'white',
  union(translate(box([2.6, 0.8, 1.1]), [0.2, 0, 0.2]), translate(box([3, 0.2, 1.5]), [0, 0.8, 0])),
);
