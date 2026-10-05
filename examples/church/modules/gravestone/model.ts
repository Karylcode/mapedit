import { box, cylinder, material, rotate, translate, union } from '@mapedit/model';

const top = translate(rotate(cylinder(0.5, 0.5, 24), [90, 0, 0]), [0.5, 1, 0]);
export default material('white', union(box([1, 1, 0.5]), top));
