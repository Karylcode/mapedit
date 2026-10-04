import { box, difference, material, translate } from '@mapedit/model';
export default material(
  'wood_planks',
  difference(box([4, 3, 0.5]), translate(box([1, 2.5, 1.5]), [1.5, 0, -0.5])),
);
