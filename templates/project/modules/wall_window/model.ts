import { box, difference, material, translate } from '@mapedit/model';
export default material(
  'plaster',
  difference(box([4, 3, 0.5]), translate(box([2, 1, 1.5]), [1, 1, -0.5])),
);
