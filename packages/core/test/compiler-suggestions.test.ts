import { expect, it } from 'vitest';
import { compileMap } from '../src/compiler.js';
import { parseProject } from '../src/format.js';

function files(): Record<string, string> {
  return {
    'project.yaml': 'name: Suggestions\n',
    'maps/site/map.yaml': 'size: {x: 100, z: 100}\n',
    'modules/block/module.yaml':
      'size: [2, 2, 2]\nsockets: [{id: east, type: wall, position: [2, 1, 1], direction: east}]\n',
    'maps/site/structures/house.yaml':
      'structures:\n  - id: house\n    position: [10, 10]\n    modules: [{id: base, module: block, at: [0, 0, 0]}]\n',
  };
}
function suggestion(input: Record<string, string>, kind: string) {
  const compiled = compileMap(parseProject(input));
  expect(compiled.scene.fileErrors).toEqual([]);
  const violation = compiled.scene.violations.find((entry) => entry.kind === kind);
  expect(violation).toBeDefined();
  return violation!.suggestion!;
}

it('F5 suggests positive legal dimensions when rounding would produce zero', () => {
  const input = files();
  input['modules/block/module.yaml'] = 'size: [0.1, 2, 2]\n';
  expect(suggestion(input, 'off_grid')).toContain('[0.5, 2, 2]');
});

it('F5 names Structure position and explicit height as separate authoring fields', () => {
  const input = files();
  input['maps/site/structures/house.yaml'] =
    'structures:\n  - id: house\n    position: [10.2, 12.8]\n    height: 0.2\n    modules: []\n';
  const advice = compileMap(parseProject(input)).scene.violations.map((entry) => entry.suggestion);
  expect(advice).toContainEqual(expect.stringContaining('position to [10, 13]'));
  expect(advice).toContainEqual(expect.stringContaining('height to 0 m'));
});

it.each([
  ['material', 'material: wood_plank\n', 'wood_planks'],
  [
    'socket type',
    'sockets: [{id: east, type: wal, position: [2, 1, 1], direction: east}]\n',
    'wall',
  ],
])('F5 gives closest existing %s ids', (_label, value, candidate) => {
  const input = files();
  input['modules/block/module.yaml'] = `size: [2, 2, 2]\n${value}`;
  expect(suggestion(input, 'missing_reference')).toContain(`"${candidate}"`);
});

it('F5 gives a closest marker type', () => {
  const input = files();
  input['maps/site/markers.yaml'] =
    'markers: [{id: start, type: spwan, shape: {kind: point, position: [20, 0, 20]}}]\n';
  expect(suggestion(input, 'missing_reference')).toContain('"spawn"');
});

it('F5 gives closest names for unknown compatible Socket types in project configuration', () => {
  const input = files();
  input['project.yaml'] += 'socketTypes: {plug: {compatibleWith: [wal]}}\n';
  expect(suggestion(input, 'missing_reference')).toContain('"wall"');
});

it('F5 gives complete candidate attachment references and own Socket ids', () => {
  const input = files();
  input['maps/site/structures/house.yaml'] =
    'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n      - {id: child, module: block, attach: {socket: eest, to: bass.east}}\n';
  const advice = suggestion(input, 'missing_reference');
  expect(advice).toContain('"east"');
  expect(advice).toContain('"base.east"');
});

it('F5 gives complete candidates for a missing cross-Structure attachment', () => {
  const input = files();
  input['maps/site/structures/house.yaml'] +=
    '  - id: child\n    attach: {socket: bass.east, to: hous/base.east}\n    modules: [{id: base, module: block, at: [0, 0, 0]}]\n';
  const advice = suggestion(input, 'missing_reference');
  expect(advice).toContain('"base.east"');
  expect(advice).toContain('"house/base.east"');
});

it('F5 suggests the minimum grid movement along both violated map axes', () => {
  const input = files();
  input['maps/site/structures/house.yaml'] =
    'structures:\n  - id: house\n    position: [-0.5, 99]\n    modules: [{id: base, module: block, at: [0, 0, 0]}]\n';
  const advice = suggestion(input, 'out_of_bounds');
  expect(advice).toContain('east by 0.5 m');
  expect(advice).toContain('north by 1 m');
});

it('F5 avoids an impossible movement suggestion when the whole Structure is too wide', () => {
  const input = files();
  input['maps/site/structures/house.yaml'] =
    'structures:\n  - id: house\n    position: [0, 0]\n    modules:\n      - {id: left, module: block, at: [-1, 0, 0]}\n      - {id: right, module: block, at: [99, 0, 0]}\n';
  const advice = suggestion(input, 'out_of_bounds');
  expect(advice).toMatch(/resize|reduce|split/i);
  expect(advice).toContain('structure:house');
});

it('F5 gives a grid-aligned correction for a rotated box Marker', () => {
  const input = files();
  input['maps/site/markers.yaml'] =
    'markers: [{id: area, type: trigger, shape: {kind: box, center: [99, 1, 10], size: [2, 2, 2], rotation: 45}}]\n';
  expect(suggestion(input, 'out_of_bounds')).toContain('Move marker:area west by 0.5 m');
  input['maps/site/markers.yaml'] = input['maps/site/markers.yaml']!.replace(
    '[99, 1, 10]',
    '[98.5, 1, 10]',
  );
  expect(compileMap(parseProject(input)).scene.violations).toEqual([]);
});

it('F5 names accepted Socket types from reverse as well as forward compatibility rules', () => {
  const input = files();
  input['project.yaml'] +=
    'socketTypes:\n  plug: {compatibleWith: []}\n  slot: {compatibleWith: [plug]}\n  cork: {compatibleWith: []}\n';
  input['modules/block/module.yaml'] =
    'size: [2, 2, 2]\nsockets: [{id: east, type: plug, position: [2, 1, 1], direction: east}]\n';
  input['modules/child/module.yaml'] =
    'size: [2, 2, 2]\nsockets: [{id: west, type: cork, position: [0, 1, 1], direction: west}]\n';
  input['maps/site/structures/house.yaml'] =
    'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n      - {id: child, module: child, attach: {socket: west, to: base.east}}\n';
  expect(suggestion(input, 'incompatible_socket')).toContain('slot');
});

it.each(['occupied', 'directions'])(
  'F5 keeps compatible type advice for %s Socket violations',
  (reason) => {
    const input = files();
    input['modules/child/module.yaml'] =
      `size: [2, 2, 2]\nsockets: [{id: west, type: wall, position: [0, 1, 1], direction: ${reason === 'directions' ? 'up' : 'west'}}]\n`;
    input['maps/site/structures/house.yaml'] =
      'structures:\n  - id: house\n    position: [10, 10]\n    modules:\n      - {id: base, module: block, at: [0, 0, 0]}\n      - {id: child, module: child, attach: {socket: west, to: base.east}}\n';
    if (reason === 'occupied')
      input['maps/site/structures/house.yaml'] +=
        '      - {id: other, module: child, attach: {socket: west, to: base.east}}\n';
    const advice = suggestion(input, 'incompatible_socket');
    expect(advice).toContain('accepts:');
    expect(advice).toContain('wall');
    expect(advice).toContain('module:house/base.east');
    expect(advice).toContain(
      reason === 'occupied' ? 'removing its existing attachment' : 'horizontal',
    );
  },
);
