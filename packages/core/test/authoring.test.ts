import { expect, it } from 'vitest';
import { parseProject, applySourceEdit, normalizeEdit } from '../src/format.js';
import { compileMap } from '../src/compiler.js';

const base = (): Record<string, string> => ({
  'project.yaml': 'name: Authoring\n',
  'maps/site/map.yaml': 'id: village\nsize: {x: 100, z: 100}\n',
  'modules/block/module.yaml': 'id: constructor\nsize: [1,1,1]\ncanFloat: true\n',
  'maps/site/structures/house.yaml':
    'structures:\n  - id: house\n    position: [5,5]\n    height: 10\n    rotation: 0\n    modules: [{id: base, module: constructor, at: [0,0,0]}]\n',
});
it('returns JSON-serializable diagnostics for an empty project and unknown map', () => {
  for (const parsed of [parseProject({}), parseProject(base())]) {
    const compiled = compileMap(parsed, 'unknown');
    expect(compiled.scene.fileErrors.length).toBeGreaterThan(0);
    expect(() => JSON.stringify(compiled.scene)).not.toThrow();
  }
});
it('uses source directories independently of ids and accepts harmless Object prototype key ids', () => {
  const parsed = parseProject(base()),
    compiled = compileMap(parsed, 'village');
  expect(compiled.scene.fileErrors).toEqual([]);
  expect(compiled.scene.violations).toEqual([]);
  expect(compiled.instances[0]?.moduleType).toBe('constructor');
  expect(parsed.maps.village?.source.file).toBe('maps/site/map.yaml');
  expect(compiled.instances[0]?.source.file).toBe('maps/site/structures/house.yaml');
});
it('preserves an explicitly positioned floating structure height through a human move', () => {
  const input = base(),
    parsed = parseProject(input);
  const edit = normalizeEdit(
    parsed,
    'village',
    { kind: 'move', ref: 'structure:house', position: [8.2, 0, 8.2], rotation: 17 },
    () => 2,
  );
  expect(edit).toMatchObject({ position: [8, 10, 8], rotation: 15 });
  const changed = applySourceEdit(parsed, 'village', edit);
  const compiled = compileMap(parseProject({ ...input, ...changed }), 'village', {
    terrainHeight: () => 2,
  });
  expect(compiled.instances[0]?.bounds.min[1]).toBe(10);
});
it('uses an explicit structure height even for a terrain-following module', () => {
  const input = base();
  input['modules/block/module.yaml'] += 'terrainFollow: true\n';
  const compiled = compileMap(parseProject(input), 'village', { terrainHeight: () => 2 });
  expect(compiled.instances[0]?.bounds.min[1]).toBe(10);
  expect(compiled.scene.violations).toEqual([]);
});
it.each([
  'properties: &recursive { self: *recursive }',
  'properties: {nested: !!set {one, two}}',
  'properties: {invalid: .inf}',
  'properties: {invalid: .nan}',
])('reports a source error instead of allowing non-JSON marker data: %s', (properties) => {
  const input = base();
  input['maps/site/markers.yaml'] =
    `markers:\n  - id: spawn\n    type: spawn\n    shape: {kind: point, position: [5,0,5]}\n    ${properties}\n`;
  const compiled = compileMap(parseProject(input));
  expect(compiled.scene.fileErrors[0]).toMatchObject({ file: 'maps/site/markers.yaml', line: 5 });
  expect(() => JSON.stringify(compiled.scene)).not.toThrow();
});
it('retains acyclic shared YAML property data as normal JSON objects', () => {
  const input = base();
  input['maps/site/markers.yaml'] =
    'markers:\n  - id: spawn\n    type: spawn\n    shape: {kind: point, position: [5,0,5]}\n    properties: {a: &shared [1, two, true], b: *shared}\n';
  const compiled = compileMap(parseProject(input));
  expect(compiled.scene.fileErrors).toEqual([]);
  expect(JSON.parse(JSON.stringify(compiled.scene.markers[0]?.properties))).toEqual({
    a: [1, 'two', true],
    b: [1, 'two', true],
  });
});
it('orders mixed-case ids by code point independently of host locale', () => {
  const input = base();
  input['maps/site/structures/house.yaml'] =
    'structures:\n' +
    ['item_z', 'item_a', 'Item_Z', 'Item_A']
      .map((id, index) => `  - id: ${id}\n    position: [${index * 2 + 5},5]\n    modules: []\n`)
      .join('');
  expect(
    compileMap(parseProject(input)).scene.structures.map((structure) => structure.ref),
  ).toEqual(['structure:Item_A', 'structure:Item_Z', 'structure:item_a', 'structure:item_z']);
});
