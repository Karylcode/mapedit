import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  violationParamsProblems,
  type TypedViolationView,
  type ViolationView,
} from '@mapedit/protocol';
import { compileMap } from '../src/compiler.js';
import { parseProject } from '../src/format.js';
import { checkGeometry } from '../src/geometry.js';
import { box } from '../src/model-api.js';
import { buildModel } from '../src/model.js';

const block = { size: [2, 2, 2] };
function compile(input: {
  project?: Record<string, unknown>;
  modules?: Record<string, Record<string, unknown>>;
  structures?: Record<string, unknown>[];
  markers?: Record<string, unknown>[];
}) {
  const files: Record<string, string> = {
    'project.yaml': stringify({ name: 'Params', ...input.project }),
    'maps/test/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/test/structures/all.yaml': stringify({ structures: input.structures ?? [] }),
  };
  for (const [id, definition] of Object.entries(input.modules ?? { block }))
    files[`modules/${id}/module.yaml`] = stringify(definition);
  if (input.markers) files['maps/test/markers.yaml'] = stringify({ markers: input.markers });
  const parsed = parseProject(files);
  expect(parsed.fileErrors).toEqual([]);
  return compileMap(parsed, 'test');
}
const placed = (id: string, modules: Record<string, unknown>[], extra = {}) => ({
  id,
  position: [10, 10],
  modules,
  ...extra,
});
/** The variant a frontend translates: kind plus field, reason or target. */
const variant = (violation: ViolationView): string => {
  const typed = violation as TypedViolationView;
  switch (typed.kind) {
    case 'off_grid':
    case 'bad_rotation':
      return `${typed.kind}:${typed.params.field}`;
    case 'missing_reference':
    case 'incompatible_socket':
      return `${typed.kind}:${typed.params.reason}`;
    case 'overlap':
      return `${typed.kind}:${typed.params.target}`;
    default:
      return typed.kind;
  }
};

describe('F23 violation params follow protocol section 3', () => {
  it('produces documented params for every compiler violation variant', async () => {
    const violations = [
      // off_grid and bad_rotation fields, plus module-definition problems.
      ...compile({
        modules: {
          block: {
            ...block,
            sockets: [{ id: 'east', type: 'wall', position: [2, 0.5, 0.5], direction: 'east' }],
          },
          odd: {
            size: [1.25, 1, 1],
            material: 'unobtainium',
            sockets: [
              { id: 'e', type: 'wall', position: [0, 0.5, 0.5], direction: 'east' },
              { id: 'skew', type: 'mystery', position: [1.25, 0, 0], rotation: 45 },
            ],
          },
        },
        structures: [
          placed('a', [{ id: 'base', module: 'block', at: [0.25, 0, 0], rotation: 45 }], {
            position: [10.25, 10],
            height: 1.25,
            rotation: 7,
          }),
          placed('b', [
            { id: 'base', module: 'block', at: [0, 0, 0] },
            { id: 'wing', module: 'odd', attach: { socket: 'e', to: 'base.east' } },
          ]),
        ],
        markers: [
          {
            id: 'point',
            type: 'spawn',
            shape: { kind: 'point', position: [5.25, 0, 5], rotation: 7 },
          },
          {
            id: 'zone',
            type: 'trigger',
            shape: { kind: 'box', center: [1, 1, 50], size: [4.25, 2, 2] },
          },
        ],
      }).scene.violations,
      // Rotations computed from Sockets, and Socket problems.
      ...compile({
        project: {
          socketTypes: { plug: { compatibleWith: ['ghost_type'] } },
          markerTypes: {},
        },
        modules: {
          post: {
            ...block,
            sockets: [
              { id: 'up', type: 'wall', position: [1, 2, 1], direction: 'up', rotation: 45 },
              { id: 'top', type: 'roof', position: [1, 2, 1.5], direction: 'up' },
              { id: 'side', type: 'stair', position: [2, 1, 1], direction: 'east' },
            ],
          },
          cap: {
            ...block,
            sockets: [
              { id: 'down', type: 'wall', position: [1, 0, 1], direction: 'down' },
              { id: 'west', type: 'roof', position: [0, 1, 1], direction: 'west' },
              { id: 'up', type: 'roof', position: [1, 2, 1], direction: 'up' },
            ],
          },
        },
        structures: [
          placed('c', [
            { id: 'base', module: 'post', at: [0, 0, 0] },
            { id: 'turned', module: 'cap', attach: { socket: 'down', to: 'base.up' } },
            { id: 'clash', module: 'cap', attach: { socket: 'west', to: 'base.side' } },
            { id: 'upside', module: 'cap', attach: { socket: 'up', to: 'base.top' } },
            { id: 'second', module: 'cap', attach: { socket: 'down', to: 'base.up' } },
          ]),
          {
            id: 'tilted',
            attach: { socket: 'base.down', to: 'c/base.up' },
            modules: [{ id: 'base', module: 'cap', at: [0, 0, 0] }],
          },
        ],
      }).scene.violations,
      // Missing references and attachment problems.
      ...compile({
        structures: [
          placed('d', [
            { id: 'base', module: 'nope', at: [0, 0, 0] },
            { id: 'lost', module: 'block', attach: { socket: 'x', to: 'missing.socket' } },
            { id: 'loop_a', module: 'block', attach: { socket: 'x', to: 'loop_b.x' } },
            { id: 'loop_b', module: 'block', attach: { socket: 'x', to: 'loop_a.x' } },
          ]),
          {
            id: 'orphan',
            attach: { socket: 'base.x', to: 'ghost/base.top' },
            modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
          },
          {
            id: 'ring_a',
            attach: { socket: 'base.x', to: 'ring_b/base.x' },
            modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
          },
          {
            id: 'ring_b',
            attach: { socket: 'base.x', to: 'ring_a/base.x' },
            modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
          },
          placed('edge', [{ id: 'base', module: 'block', at: [0, 0, 0] }], { position: [99, 10] }),
        ],
        markers: [{ id: 'chest', type: 'treasure', shape: { kind: 'point', position: [5, 0, 5] } }],
      }).scene.violations,
    ];
    for (const violation of violations)
      expect(violationParamsProblems(violation), JSON.stringify(violation)).toEqual([]);
    const variants = new Set(violations.map(variant));
    for (const expected of [
      'off_grid:structure_position',
      'off_grid:structure_height',
      'off_grid:module_position',
      'off_grid:attached_module_position',
      'off_grid:module_size',
      'off_grid:socket_position',
      'off_grid:marker_position',
      'off_grid:marker_size',
      'bad_rotation:structure',
      'bad_rotation:structure_attachment',
      'bad_rotation:module',
      'bad_rotation:attached_module',
      'bad_rotation:socket',
      'bad_rotation:marker',
      'missing_reference:unknown_module',
      'missing_reference:unknown_socket_type',
      'missing_reference:unknown_material',
      'missing_reference:unknown_marker_type',
      'missing_reference:unresolved_attachment',
      'missing_reference:attachment_cycle',
      'incompatible_socket:types',
      'incompatible_socket:occupied',
      'incompatible_socket:directions',
      'out_of_bounds',
    ])
      expect(variants, expected).toContain(expected);

    const find = (kind: string, test: (params: Record<string, unknown>) => boolean) =>
      violations.find((item) => item.kind === kind && test(item.params))!.params;
    expect(find('off_grid', (p) => p.field === 'structure_position')).toMatchObject({
      values: [10.25, 10],
      nearest: [10.5, 10],
    });
    expect(find('off_grid', (p) => p.field === 'module_size')).toMatchObject({
      values: [1.25, 1, 1],
      nearest: [1.5, 1, 1],
      moduleType: 'odd',
    });
    expect(find('bad_rotation', (p) => p.field === 'structure')).toMatchObject({
      rotation: 7,
      step: 15,
      nearest: 0,
    });
    expect(find('out_of_bounds', (p) => JSON.stringify(p).includes('east'))).toMatchObject({
      edges: [{ edge: 'east', distance: 1 }],
      size: { x: 100, z: 100 },
    });
    expect(find('out_of_bounds', (p) => JSON.stringify(p).includes('west'))).toMatchObject({
      edges: [{ edge: 'west', distance: 1.125 }],
    });
    expect(find('incompatible_socket', (p) => p.reason === 'types')).toMatchObject({
      socketA: 'module:c/clash.west',
      socketB: 'module:c/base.side',
      typeA: 'roof',
      typeB: 'stair',
    });
    expect(find('missing_reference', (p) => p.reason === 'unknown_material')).toMatchObject({
      reference: 'unobtainium',
      moduleType: 'odd',
    });
  });

  it('produces documented params for geometry violations', async () => {
    const compiled = compile({
      structures: [
        placed('left', [{ id: 'base', module: 'block', at: [0, 0, 0] }]),
        placed('right', [{ id: 'base', module: 'block', at: [0, 0, 0] }], { position: [11, 10] }),
        placed('buried', [{ id: 'base', module: 'block', at: [0, 0, 0] }], {
          position: [30, 10],
          height: -1,
        }),
        placed('floating', [{ id: 'base', module: 'block', at: [0, 0, 0] }], {
          position: [50, 10],
          height: 3,
        }),
      ],
    });
    const { violations } = await checkGeometry(
      compiled,
      new Map([['block', await buildModel(box([2, 2, 2]))]]),
    );
    for (const violation of violations)
      expect(violationParamsProblems(violation), JSON.stringify(violation)).toEqual([]);
    expect(new Set(violations.map(variant))).toEqual(
      new Set(['overlap:module', 'overlap:terrain', 'unsupported']),
    );
  });

  it('reports undocumented, missing and malformed params', () => {
    const base = { id: 'x', message: 'm', refs: [] };
    expect(
      violationParamsProblems({ ...base, kind: 'overlap', params: { target: 'sky', extra: 1 } }),
    ).toEqual(['target has an invalid value.', 'extra is not a documented overlap param.']);
    expect(
      violationParamsProblems({ ...base, kind: 'unsupported', params: { file: 'a.yaml' } }),
    ).toEqual(['file and line must appear together.']);
    expect(violationParamsProblems({ ...base, kind: 'bad_rotation', params: {} })).toEqual([
      'field is required.',
      'rotation is required.',
      'step is required.',
      'nearest is required.',
    ]);
  });
});
