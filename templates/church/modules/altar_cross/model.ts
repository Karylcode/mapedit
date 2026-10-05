import { box, material, translate, union } from '@mapedit/model';

// A tall cross on a plinth behind the altar, facing west down the nave.
export default material(
  'white',
  union(
    translate(box([0.5, 0.6, 1]), [0, 0, 0.5]),
    translate(box([0.25, 4.4, 0.25]), [0.125, 0.6, 0.875]),
    translate(box([0.25, 0.25, 2]), [0.125, 3.6, 0]),
  ),
);
