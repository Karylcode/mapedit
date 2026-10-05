import { box, difference, material, translate } from '@mapedit/model';

// The stone floor of one nave bay.
// Flagstones 1 m square: shallow joints cut into the top face.
const joints = [
  ...Array.from({ length: 5 }, (_, i) => translate(box([0.06, 0.1, 10]), [i + 0.97, 0.45, 0])),
  ...Array.from({ length: 9 }, (_, i) => translate(box([6, 0.1, 0.06]), [0, 0.45, i + 0.97])),
];
export default material('white', difference(box([6, 0.5, 10]), ...joints));
