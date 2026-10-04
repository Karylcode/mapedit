import { expect, it } from 'vitest';
import { parseProject } from '../src/format.js';

it.each(['[]', '[custom_wood]', 'null'])(
  'F9 rejects project materials declarations even when empty: %s',
  (declaration) => {
    const parsed = parseProject({
      'project.yaml': `name: Materials\nmaterials: ${declaration}\n`,
      'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
    });
    expect(parsed.fileErrors).toContainEqual(
      expect.objectContaining({
        file: 'project.yaml',
        line: 2,
        message: expect.stringMatching(
          /built.in materials.*version 1|version 1.*built.in materials/i,
        ),
      }),
    );
  },
);

it('F9 permits built-in module materials without a project materials declaration', () => {
  const parsed = parseProject({
    'project.yaml': 'name: Built in materials\n',
    'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
    'modules/wall/module.yaml': 'size: [2,2,0.5]\nmaterial: wood_planks\n',
  });
  expect(parsed.fileErrors).toEqual([]);
  expect(parsed.modules.wall?.material).toBe('wood_planks');
});
