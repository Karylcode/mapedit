import { extrude, material, rotate } from '@mapedit/model';
export default material(
  'roof_tiles',
  rotate(
    extrude(
      [
        [0, 0],
        [2, -1],
        [4, 0],
      ],
      4,
    ),
    [90, 0, 0],
  ),
);
