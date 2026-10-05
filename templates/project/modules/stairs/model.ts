import { box, material, translate, union } from '@mapedit/model';
export default material(
  'stone_brick',
  union(box([2, 0.5, 2]), translate(box([2, 0.5, 1]), [0, 0.5, 0])),
);
