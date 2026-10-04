import { describe, expect, it } from 'vitest';
import { compileMap } from '../src/compiler.js';
import { parseProject } from '../src/format.js';
import { checkGeometry } from '../src/geometry.js';
import { buildModel } from '../src/model.js';
import { box } from '../src/model-api.js';
import { parseObjectRef } from '@mapedit/protocol';
import { stringify } from 'yaml';

describe('stable violation identities', () => {
  it('keeps physical overlap identity when its two Module refs arrive in the opposite order', async () => {
    const compilation = compileMap(
      parseProject({
        'project.yaml': 'name: Overlap identities\n',
        'modules/block/module.yaml': 'size: [2, 2, 2]\n',
        'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
        'maps/test/structures/test.yaml':
          'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: a, module: block, at: [0, 0, 0]}\n      - {id: b, module: block, at: [1, 0, 0]}\n',
      }),
      'test',
    );
    const models = new Map([['block', await buildModel(box([2, 2, 2]))]]);
    const before = await checkGeometry(compilation, models);
    const after = await checkGeometry(
      { ...compilation, instances: [...compilation.instances].reverse() },
      models,
    );
    expect(before.violations).toHaveLength(1);
    expect(after.violations).toHaveLength(1);
    expect(after.violations[0]!.id).toBe(before.violations[0]!.id);
  });
  it('distinguishes same-kind violations on one Module and preserves the remaining field identities', () => {
    const files = {
      'project.yaml': 'name: Stable violations\n',
      'modules/block/module.yaml':
        'size: [2.25, 1, 2]\nsockets:\n  - {id: left, type: floor, position: [0.25, 0.5, 0], direction: north}\n  - {id: right, type: floor, position: [1.25, 0.5, 0], direction: north}\n',
      'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/test/structures/test.yaml':
        'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0.25, 0, 0]}\n',
    };
    const before = compileMap(parseProject(files), 'test').scene.violations.filter(
      (value) => value.kind === 'off_grid',
    );
    expect(before).toHaveLength(4);
    expect(new Set(before.map((value) => value.id)).size).toBe(4);
    const changed = {
      ...files,
      'modules/block/module.yaml': files['modules/block/module.yaml']
        .replace('[2.25, 1, 2]', '[2, 1, 2]')
        .replace('[0.25, 0.5, 0]', '[0, 0.5, 0]'),
      'maps/test/structures/test.yaml': files['maps/test/structures/test.yaml'].replace(
        '[0.25, 0, 0]',
        '[0.1, 0, 0]',
      ),
    };
    const after = compileMap(parseProject(changed), 'test', {
      revision: 8,
    }).scene.violations.filter((value) => value.kind === 'off_grid');
    expect(after).toHaveLength(2);
    for (const violation of after)
      expect(violation.id).toBe(before.find((value) => value.message === violation.message)?.id);
  });
});

it('F26 violation ids use fixed rule ids, not display labels or ObjectRef-like text', () => {
  const compiled = compileMap(
    parseProject({
      'project.yaml': 'name: Rules\n',
      'modules/odd/module.yaml': stringify({
        size: [1.25, 2, 2],
        material: 'unobtainium',
        sockets: [{ id: 'edge', type: 'wall', position: [0.25, 1, 1], rotation: 45 }],
      }),
      'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/test/structures/test.yaml': stringify({
        structures: [
          {
            id: 'house',
            position: [10.25, 10],
            height: 0.25,
            rotation: 7,
            modules: [{ id: 'base', module: 'odd', at: [0.25, 0, 0], rotation: 45 }],
          },
        ],
      }),
    }),
    'test',
  );
  const rules = compiled.scene.violations.map((violation) => {
    const [, rule] = JSON.parse(violation.id.slice(violation.kind.length + 1)) as [
      string[],
      string,
    ];
    return rule;
  });
  expect(rules.sort()).toEqual(
    [
      'definition:odd:material',
      'definition:odd:size',
      'definition:odd:socket:edge:position',
      'definition:odd:socket:edge:rotation',
      'module',
      'module_position',
      'structure',
      'structure_height',
      'structure_position',
    ].sort(),
  );
  for (const rule of rules) {
    expect(rule, 'labels contain spaces and quotes').not.toMatch(/[\s"]/);
    expect(parseObjectRef(rule), rule).toBeUndefined();
    expect(rule.startsWith('module:'), rule).toBe(false);
  }
});
