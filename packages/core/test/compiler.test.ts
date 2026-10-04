import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { compileMap } from '../src/compiler.js';
import { applySourceEdit, normalizeEdit, parseProject } from '../src/format.js';

const structureFile = 'maps/village/structures/houses.yaml';
const basicStructure = {
  id: 'house',
  position: [10, 10],
  rotation: 0,
  modules: [{ id: 'base', module: 'block', at: [0, 0, 0] }],
};
function files(structures: unknown[] = [basicStructure]): Record<string, string> {
  return {
    'project.yaml': 'version: 1\nname: Village\n',
    'modules/block/module.yaml': stringify({
      id: 'block',
      size: [2, 1, 2],
      sockets: [
        { id: 'east', type: 'foundation', position: [2, 0.5, 1], direction: 'east' },
        { id: 'west', type: 'foundation', position: [0, 0.5, 1], direction: 'west' },
        { id: 'top', type: 'floor', position: [1, 1, 1], direction: 'up' },
        { id: 'bottom', type: 'floor', position: [1, 0, 1], direction: 'down' },
      ],
    }),
    'maps/village/map.yaml': 'id: village\nname: Village\nsize: {x: 100, z: 100}\n',
    [structureFile]: stringify({ structures }),
    'maps/village/markers.yaml': stringify({
      markers: [
        {
          id: 'spawn_home',
          type: 'spawn',
          shape: { kind: 'point', position: [5, 0, 5], rotation: 0 },
          properties: { team: 'blue' },
        },
      ],
    }),
  };
}
const kinds = (input: Record<string, string>) =>
  compileMap(parseProject(input)).scene.violations.map((v) => v.kind);

describe('project format and deterministic compilation', () => {
  it('compiles a stable golden scene regardless of file insertion order', () => {
    const input = files([
      {
        ...basicStructure,
        rotation: 30,
        modules: [
          ...basicStructure.modules,
          { id: 'east', module: 'block', attach: { socket: 'west', to: 'base.east' } },
          { id: 'upper', module: 'block', attach: { socket: 'bottom', to: 'base.top' } },
        ],
      },
    ]);
    const compiled = compileMap(parseProject(input));
    expect(compiled.scene.fileErrors).toEqual([]);
    expect(compiled.scene.violations).toEqual([]);
    expect(compiled.scene).toMatchSnapshot();
    expect(compileMap(parseProject(Object.fromEntries(Object.entries(input).reverse())))).toEqual(
      compiled,
    );
    const a = compiled.sockets.find((s) => s.ref === 'module:house/base.east')!,
      b = compiled.sockets.find((s) => s.ref === 'module:house/east.west')!;
    expect(a.position).toEqual(b.position);
    expect(a.occupied).toBe(true);
    expect(b.occupied).toBe(true);
  });
  it('keeps rotated module minimum corner at the declared at coordinate', () => {
    const compiled = compileMap(
      parseProject(
        files([
          {
            ...basicStructure,
            modules: [{ id: 'base', module: 'block', at: [0, 0, 0], rotation: 90 }],
          },
        ]),
      ),
    );
    expect(compiled.instances[0]?.bounds).toEqual({ min: [10, 0, 10], max: [12, 1, 12] });
  });
  it('merges structures connected by sockets while retaining stable source refs', () => {
    const compiled = compileMap(
      parseProject(
        files([
          basicStructure,
          {
            id: 'annex',
            attach: { socket: 'base.west', to: 'house/base.east' },
            modules: basicStructure.modules,
          },
        ]),
      ),
    );
    expect(compiled.scene.violations).toEqual([]);
    expect(compiled.scene.structures).toHaveLength(1);
    expect(compiled.scene.structures[0]?.ref).toBe('structure:house');
    expect(compiled.instances.find((i) => i.ref === 'module:annex/base')?.bounds.min).toEqual([
      12, 0, 10,
    ]);
    expect(compiled.socketConnections).toContainEqual({
      a: 'module:annex/base',
      b: 'module:house/base',
    });
  });
  it('uses terrain for auto height and preserves explicit height', () => {
    const input = files([
      basicStructure,
      { ...basicStructure, id: 'island', position: [20, 20], height: 10 },
    ]);
    const compiled = compileMap(parseProject(input), 'village', { terrainHeight: () => 2.5 });
    expect(compiled.instances.map((i) => i.bounds.min[1])).toEqual([2.5, 10]);
  });
  it.each([
    ['off_grid', { ...basicStructure, position: [10.2, 10] }],
    ['off_grid', { ...basicStructure, height: 0.2 }],
    ['bad_rotation', { ...basicStructure, rotation: 20 }],
    [
      'bad_rotation',
      {
        ...basicStructure,
        modules: [{ id: 'base', module: 'block', at: [0, 0, 0], rotation: 15 }],
      },
    ],
    ['out_of_bounds', { ...basicStructure, position: [99, 10] }],
    [
      'missing_reference',
      { ...basicStructure, modules: [{ id: 'base', module: 'absent', at: [0, 0, 0] }] },
    ],
    [
      'missing_reference',
      {
        ...basicStructure,
        modules: [{ id: 'base', module: 'block', attach: { socket: 'west', to: 'absent.east' } }],
      },
    ],
  ])('reports %s with file, line and actionable suggestion', (kind, structure) => {
    const result = compileMap(parseProject(files([structure]))).scene.violations.find(
      (v) => v.kind === kind,
    );
    expect(result).toBeDefined();
    expect(result?.params.file).toBe(structureFile);
    expect(result?.params.line).toBeGreaterThan(0);
    expect(result?.suggestion).toBeTruthy();
  });
  it('reports incompatible socket types, directions and already occupied sockets', () => {
    const input = files([
      {
        ...basicStructure,
        modules: [
          ...basicStructure.modules,
          { id: 'second', module: 'block', attach: { socket: 'west', to: 'base.east' } },
          { id: 'third', module: 'block', attach: { socket: 'west', to: 'base.east' } },
        ],
      },
    ]);
    input['project.yaml'] += 'socketTypes:\n  foundation: {compatibleWith: []}\n';
    expect(kinds(input).filter((k) => k === 'incompatible_socket')).toHaveLength(3);
    const directions = files([
      {
        ...basicStructure,
        modules: [
          ...basicStructure.modules,
          { id: 'second', module: 'block', attach: { socket: 'top', to: 'base.top' } },
        ],
      },
    ]);
    expect(kinds(directions)).toContain('incompatible_socket');
  });
  it('reports module and structure attachment cycles without throwing', () => {
    const cyclic = [
      { id: 'a', module: 'block', attach: { socket: 'west', to: 'b.east' } },
      { id: 'b', module: 'block', attach: { socket: 'west', to: 'a.east' } },
    ];
    expect(kinds(files([{ ...basicStructure, modules: cyclic }]))).toContain('missing_reference');
    expect(
      kinds(
        files([
          {
            id: 'a',
            attach: { socket: 'base.west', to: 'b/base.east' },
            modules: basicStructure.modules,
          },
          {
            id: 'b',
            attach: { socket: 'base.west', to: 'a/base.east' },
            modules: basicStructure.modules,
          },
        ]),
      ),
    ).toContain('missing_reference');
  });
  it('validates material, socket type and marker references', () => {
    const input = files();
    input['modules/block/module.yaml'] += 'material: unknown\n';
    input['project.yaml'] += 'socketTypes:\n  custom: {compatibleWith: [missing]}\n';
    input['maps/village/markers.yaml'] = input['maps/village/markers.yaml']!.replace(
      'type: spawn',
      'type: unknown',
    );
    expect(kinds(input).filter((k) => k === 'missing_reference')).toHaveLength(3);
  });
  it('returns source-located errors for syntax, malformed fields and duplicates', () => {
    const syntax = files();
    syntax[structureFile] = 'structures:\n - id: [\n';
    expect(parseProject(syntax).fileErrors[0]).toMatchObject({ file: structureFile, line: 3 });
    const invalid = files();
    invalid['modules/block/module.yaml'] = 'id: block\nsize: [2, 0, 2]\n';
    expect(parseProject(invalid).fileErrors[0]).toMatchObject({
      file: 'modules/block/module.yaml',
      line: 2,
    });
    expect(parseProject(files([basicStructure, basicStructure])).fileErrors[0]?.message).toContain(
      'Duplicate',
    );
    const unknown = files();
    unknown['maps/village/map.yaml'] += 'typo: true\n';
    expect(parseProject(unknown).fileErrors[0]?.message).toContain('Unknown field');
  });
  it('rejects coordinates on attached objects instead of silently ignoring them', () => {
    const input = files([
      {
        ...basicStructure,
        modules: [{ ...basicStructure.modules[0], attach: { socket: 'west', to: 'other.east' } }],
      },
    ]);
    expect(parseProject(input).fileErrors[0]?.message).toContain('remove at and rotation');
  });
  it('checks a rotated trigger volume rather than only its center', () => {
    const input = files();
    input['maps/village/markers.yaml'] = stringify({
      markers: [
        {
          id: 'zone',
          type: 'trigger',
          shape: { kind: 'box', center: [99, 1, 50], size: [4, 2, 4], rotation: 45 },
        },
      ],
    });
    expect(kinds(input)).toContain('out_of_bounds');
  });
  it('compiles 2,000 modules within the 2-second budget', () => {
    const input = files([
      {
        ...basicStructure,
        modules: Array.from({ length: 2000 }, (_, i) => ({
          id: `tile_${i}`,
          module: 'block',
          at: [(i % 40) * 2, 0, Math.floor(i / 40) * 2],
        })),
      },
    ]);
    input['maps/village/map.yaml'] = 'id: village\nsize: {x: 1000, z: 1000}\n';
    const start = performance.now(),
      compiled = compileMap(parseProject(input));
    expect(compiled.instances).toHaveLength(2000);
    expect(compiled.scene.violations).toEqual([]);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('source-preserving human edits', () => {
  it('preserves comments, spacing, quotes and CRLF for existing scalar moves', () => {
    const input = files();
    input[structureFile] =
      '# Keep this note\r\nstructures:\r\n  - id: house\r\n    name: "My house"\r\n    position: [10,   10] # chosen site\r\n    rotation: 0 # angle\r\n    modules:\r\n      - {id: base, module: block, at: [0, 0, 0]}\r\n';
    const parsed = parseProject(input),
      edit = normalizeEdit(
        parsed,
        'village',
        { kind: 'move', ref: 'structure:house', position: [11.24, 99, 12.26], rotation: 17 },
        () => 2.5,
      );
    expect(edit).toMatchObject({ position: [11, 2.5, 12.5], rotation: 15 });
    const output = applySourceEdit(parsed, 'village', edit)[structureFile];
    expect(output).toBe(
      input[structureFile]
        .replace('[10,   10]', '[11,   12.5]')
        .replace('rotation: 0', 'rotation: 15'),
    );
    expect(parsed.files[structureFile]).toBe(input[structureFile]);
  });
  it('deletes a module and preserves unrelated comments', () => {
    const input = files();
    input[structureFile] = '# House comment\n' + input[structureFile];
    const changed = applySourceEdit(parseProject(input), 'village', {
      kind: 'delete',
      ref: 'module:house/base',
    });
    expect(changed[structureFile]).toContain('# House comment');
    expect(parseProject({ ...input, ...changed }).maps.village?.structures[0]?.modules).toEqual([]);
  });
  it('deletes the complete merged structure across files', () => {
    const input = files();
    input['maps/village/structures/annex.yaml'] = stringify({
      structures: [
        {
          id: 'annex',
          attach: { socket: 'base.west', to: 'house/base.east' },
          modules: basicStructure.modules,
        },
      ],
    });
    const changed = applySourceEdit(parseProject(input), 'village', {
      kind: 'delete',
      ref: 'structure:house',
    });
    expect(Object.keys(changed)).toHaveLength(2);
    expect(parseProject({ ...input, ...changed }).maps.village?.structures).toEqual([]);
  });
  it('moves and deletes markers using their source paths', () => {
    const input = files(),
      parsed = parseProject(input);
    const changed = applySourceEdit(parsed, 'village', {
      kind: 'move',
      ref: 'marker:spawn_home',
      position: [10, 0, 15],
      rotation: 30,
    });
    expect(parseProject({ ...input, ...changed }).maps.village?.markers[0]?.shape).toEqual({
      kind: 'point',
      position: [10, 0, 15],
      rotation: 30,
    });
    const deleted = applySourceEdit(parsed, 'village', {
      kind: 'delete',
      ref: 'marker:spawn_home',
    });
    expect(parseProject({ ...input, ...deleted }).maps.village?.markers).toEqual([]);
  });
});
