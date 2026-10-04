import { expect, it } from 'vitest';
import {
  compileMap,
  parseProject,
  listFloatingInstances,
  buildModel,
  box,
  checkGeometry,
} from '../src/index.js';

it('F4 lists all canFloat instances while floating islands still support ordinary houses', async () => {
  const compilation = compileMap(
    parseProject({
      'project.yaml': 'name: Floating report\n',
      'modules/island/module.yaml': 'id: island\nsize: [2,1,2]\ncanFloat: true\n',
      'modules/house/module.yaml': 'id: house\nsize: [2,1,2]\n',
      'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/test/structures/objects.yaml': `structures:
  - id: flying
    position: [20,20]
    height: 5
    modules:
      - {id: island, module: island, at: [0,0,0]}
      - {id: house, module: house, at: [0,1,0]}
  - id: grounded
    position: [10,10]
    modules: [{id: island, module: island, at: [0,0,0]}]
`,
    }),
  );
  const shape = await buildModel(box([2, 1, 2]), [2, 1, 2]);
  const result = await checkGeometry(
    compilation,
    new Map([
      ['island', shape],
      ['house', shape],
    ]),
    { heightAt: () => 0 },
  );
  expect(compilation.scene.fileErrors).toEqual([]);
  expect([...compilation.scene.violations, ...result.violations]).toEqual([]);
  expect(listFloatingInstances(compilation.scene)).toEqual([
    { ref: 'module:flying/island', moduleType: 'island', position: [20, 5, 20] },
    { ref: 'module:grounded/island', moduleType: 'island', position: [10, 0, 10] },
  ]);
});
