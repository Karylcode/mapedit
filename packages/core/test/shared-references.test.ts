import { describe, expect, it } from 'vitest';
import { parseObjectRef } from '@mapedit/protocol';
import { compileMap } from '../src/compiler.js';
import { parseProject } from '../src/format.js';
import { BUILTIN_MATERIAL_IDS, BUILTIN_MATERIALS, getMaterial } from '../src/index.js';
import { stringify } from 'yaml';

describe('F15 shared references and material ids', () => {
  it.each(['house\n', 'house\r', 'house\r\n'])(
    'reports an invalid source identifier as a FileError instead of throwing during compilation: %j',
    (id) => {
      const parsed = parseProject({
        'project.yaml': 'name: Invalid identifiers\n',
        'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
        'maps/test/structures/invalid.yaml': stringify({
          structures: [{ id, position: [10, 10], modules: [] }],
        }),
      });
      expect(parsed.fileErrors).toEqual([
        expect.objectContaining({
          file: 'maps/test/structures/invalid.yaml',
          message: expect.stringContaining('stable id'),
        }),
      ]);
      expect(() => compileMap(parsed, 'test')).not.toThrow();
    },
  );
  it('keeps unused definition diagnostics distinct and stable without inventing ObjectRef kinds', () => {
    const definition =
      'size: [2.25, 2, 2]\nmaterial: absent\nsockets:\n  - {id: edge, type: floor, position: [0.25, 1, 0], rotation: 17}\n';
    const files = {
      'project.yaml': 'name: Definitions\n',
      'modules/alpha/module.yaml': definition,
      'modules/beta/module.yaml': definition,
      'maps/first/map.yaml': 'size: {x: 100, z: 100}\n',
      'maps/second/map.yaml': 'size: {x: 100, z: 100}\n',
    };
    const before = compileMap(parseProject(files), 'first').scene.violations;
    expect(before).toHaveLength(8);
    expect(new Set(before.map((violation) => violation.id)).size).toBe(8);
    for (const violation of before) {
      expect(violation.refs).toEqual([]);
      expect(['alpha', 'beta']).toContain(violation.params.moduleType);
    }
    const after = compileMap(
      parseProject({
        ...files,
        'modules/alpha/module.yaml': '# shifted source lines\n' + definition,
      }),
      'second',
      { revision: 7 },
    ).scene.violations;
    expect(after.map((violation) => violation.id)).toEqual(before.map((violation) => violation.id));
  });

  it('emits only protocol ObjectRefs for placed objects and retains existing diagnostic identity', () => {
    const compilation = compileMap(
      parseProject({
        'project.yaml': 'name: References\n',
        'modules/block/module.yaml': 'size: [2, 2, 2]\n',
        'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
        'maps/test/structures/house.yaml':
          'structures:\n  - id: house\n    position: [10.2, 10]\n    modules: [{id: base, module: block, at: [0, 0, 0]}]\n',
        'maps/test/markers.yaml':
          'markers:\n  - id: spawn\n    type: spawn\n    shape: {kind: point, position: [5, 0, 5]}\n',
      }),
    );
    const refs = [
      ...compilation.scene.structures.flatMap((structure) => [
        structure.ref,
        ...structure.instances.map((instance) => instance.ref),
      ]),
      ...compilation.scene.markers.map((marker) => marker.ref),
      ...compilation.scene.violations.flatMap((violation) => violation.refs),
    ];
    for (const ref of refs) expect(parseObjectRef(ref)).toBeDefined();
    expect(compilation.scene.violations[0]?.id).toBe(
      'off_grid:[["structure:house"],"Structure \\"house\\" position"]',
    );
  });

  it('derives selectable material ids from the real built-in material definitions', () => {
    expect(BUILTIN_MATERIAL_IDS).toEqual(BUILTIN_MATERIALS.map((material) => material.id));
    expect(new Set(BUILTIN_MATERIAL_IDS).size).toBe(BUILTIN_MATERIAL_IDS.length);
    for (const id of BUILTIN_MATERIAL_IDS) expect(getMaterial(id).id).toBe(id);
  });
});
