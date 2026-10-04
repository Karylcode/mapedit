import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Vec3, ViolationView } from '@mapedit/protocol';
import { compileMap } from '../src/compiler.js';
import type { Compilation } from '../src/domain.js';
import { parseProject } from '../src/format.js';
import { checkGeometry } from '../src/geometry.js';
import { socketAddress } from '../src/socket-rules.js';
import { box, union, type Shape } from '../src/model-api.js';
import { buildModel, type ModelGeometry } from '../src/model.js';

interface TestModule {
  id: string;
  size?: Vec3;
  canFloat?: boolean;
  terrainFollow?: boolean;
  sockets?: { id: string; type: string; position: Vec3; direction: string }[];
}
interface TestStructure {
  id: string;
  position: [number, number];
  height?: number;
  rotation?: number;
  modules: {
    id: string;
    module: string;
    at?: Vec3;
    attach?: { socket: string; to: string };
  }[];
}
const placed = (id: string, position: Vec3, module = 'block'): TestStructure => ({
  id,
  position: [position[0], position[2]],
  height: position[1],
  modules: [{ id: 'base', module, at: [0, 0, 0] }],
});
function fixture(
  structures: TestStructure[],
  definitions: TestModule[] = [{ id: 'block' }],
  project: Record<string, unknown> = {},
): Compilation {
  return compileMap(
    parseProject({
      'project.yaml': stringify({ name: 'Suggestions', ...project }),
      ...Object.fromEntries(
        definitions.map((definition) => [
          `modules/${definition.id}/module.yaml`,
          stringify({ size: [2, 2, 2], ...definition }),
        ]),
      ),
      'maps/test/map.yaml': 'name: Test\nsize: { x: 100, z: 100 }\n',
      'maps/test/structures/buildings.yaml': stringify({ structures }),
    }),
    'test',
  );
}
async function geometryModels(
  definitions: Record<string, Shape> = { block: box([2, 2, 2]) },
): Promise<Map<string, ModelGeometry>> {
  return new Map(
    await Promise.all(
      Object.entries(definitions).map(
        async ([id, shape]) => [id, await buildModel(shape)] as const,
      ),
    ),
  );
}
function violationOf(violations: ViolationView[], kind: ViolationView['kind']): ViolationView {
  const result = violations.find((violation) => violation.kind === kind);
  expect(result, `Expected a ${kind} violation in the fixture`).toBeDefined();
  return result!;
}
function expectLocation(violation: ViolationView): Vec3 {
  expect(violation.location).toHaveLength(3);
  expect(violation.location!.every(Number.isFinite)).toBe(true);
  return violation.location!;
}
function suggestedMove(violation: ViolationView): {
  structureId: string;
  delta: Vec3;
  distance: number;
} {
  const suggestion = violation.suggestion ?? '';
  const reference = /\bstructure:([A-Za-z][A-Za-z0-9_-]*)\b/.exec(suggestion);
  const direction = /\b(east|west|south|north)\b/i.exec(suggestion);
  const amount = /\b(\d+(?:\.\d+)?)\s*(?:m\b|metres\b|meters\b)/i.exec(suggestion);
  expect(reference, 'Movement advice names the Structure to move').not.toBeNull();
  expect(direction, 'Movement advice names a cardinal direction').not.toBeNull();
  expect(amount, 'Movement advice includes a numeric distance in metres').not.toBeNull();
  const distance = Number(amount![1]);
  const offsets: Record<string, Vec3> = {
    east: [distance, 0, 0],
    west: [-distance, 0, 0],
    south: [0, 0, distance],
    north: [0, 0, -distance],
  };
  return { structureId: reference![1]!, delta: offsets[direction![1]!.toLowerCase()]!, distance };
}
function moved(compilation: Compilation, structureId: string, delta: Vec3): Compilation {
  const candidate = structuredClone(compilation);
  for (const instance of candidate.instances) {
    if (instance.structureId !== structureId) continue;
    for (let axis = 0; axis < 3; axis++) instance.transform[12 + axis]! += delta[axis]!;
  }
  return candidate;
}

describe('F5 concrete compiler suggestions', () => {
  it('reports the closest legal coordinates for off_grid', () => {
    const structure = placed('house', [10.2, 0, 12.8]);
    const violation = violationOf(fixture([structure]).scene.violations, 'off_grid');
    expect(violation.suggestion).toContain('10');
    expect(violation.suggestion).toContain('13');
  });
  it('reports the closest legal angle for bad_rotation', () => {
    const structure = { ...placed('house', [10, 0, 10]), rotation: 17 };
    const violation = violationOf(fixture([structure]).scene.violations, 'bad_rotation');
    expect(violation.suggestion).toMatch(/\b15\b/);
  });
  it('reports the direction and minimum legal correction for out_of_bounds', () => {
    const violation = violationOf(
      fixture([placed('house', [99, 0, 10])]).scene.violations,
      'out_of_bounds',
    );
    expect(violation.suggestion).toMatch(/\bwest\b/i);
    expect(violation.suggestion).toMatch(/\b1(?:\.0)?\s*(?:m\b|metres\b|meters\b)/i);
  });
  it('offers the closest existing identifier for missing_reference', () => {
    const violation = violationOf(
      fixture(
        [placed('house', [10, 0, 10], 'blok')],
        [{ id: 'block' }, { id: 'tree' }, { id: 'roof' }],
      ).scene.violations,
      'missing_reference',
    );
    expect(violation.suggestion).toContain('block');
  });
  it('lists types accepted by the incompatible Socket', () => {
    const compiled = fixture(
      [
        {
          ...placed('house', [10, 0, 10], 'plug_module'),
          modules: [
            { id: 'base', module: 'plug_module', at: [0, 0, 0] },
            { id: 'child', module: 'cork_module', attach: { socket: 'west', to: 'base.east' } },
          ],
        },
      ],
      [
        {
          id: 'plug_module',
          sockets: [{ id: 'east', type: 'plug', position: [2, 1, 1], direction: 'east' }],
        },
        {
          id: 'cork_module',
          sockets: [{ id: 'west', type: 'cork', position: [0, 1, 1], direction: 'west' }],
        },
      ],
      {
        socketTypes: {
          plug: { compatibleWith: ['slot'] },
          slot: { compatibleWith: [] },
          cork: { compatibleWith: [] },
        },
      },
    );
    const violation = violationOf(compiled.scene.violations, 'incompatible_socket');
    expect(violation.suggestion).toContain('slot');
  });
});

describe('F5 concrete geometry suggestions', () => {
  it('locates an overlap and offers the shortest half-metre cardinal move that clears it', async () => {
    const compiled = fixture([placed('alpha', [10, 0, 10]), placed('beta', [11.5, 0, 10])]);
    const models = await geometryModels();
    const violation = violationOf((await checkGeometry(compiled, models)).violations, 'overlap');
    const location = expectLocation(violation);
    expect(location[0]).toBeGreaterThanOrEqual(11.5);
    expect(location[0]).toBeLessThanOrEqual(12);
    expect(violation.suggestion).toContain('structure:alpha');
    expect(violation.suggestion).toContain('structure:beta');
    const move = suggestedMove(violation);
    expect(move.distance).toBe(0.5);
    expect(
      (
        await checkGeometry(moved(compiled, move.structureId, move.delta), models)
      ).violations.filter((item) => item.kind === 'overlap'),
    ).toEqual([]);
  });
  it('uses the true hollow shape when testing a suggested clearance', async () => {
    const compiled = fixture(
      [placed('alpha', [10, 0, 10], 'corner'), placed('beta', [10.5, 0, 10], 'small')],
      [{ id: 'corner' }, { id: 'small', size: [0.5, 1, 0.5] }],
    );
    const models = await geometryModels({
      corner: union(box([0.5, 2, 2]), box([2, 2, 0.5])),
      small: box([0.5, 1, 0.5]),
    });
    const violation = violationOf((await checkGeometry(compiled, models)).violations, 'overlap');
    const move = suggestedMove(violation);
    expect(move.distance).toBe(0.5);
    expect(
      (
        await checkGeometry(moved(compiled, move.structureId, move.delta), models)
      ).violations.filter((item) => item.kind === 'overlap'),
    ).toEqual([]);
  });
  it('checks every Module in the moving Structure before recommending clearance', async () => {
    const compiled = fixture([
      {
        ...placed('alpha', [10, 0, 10]),
        modules: [
          { id: 'base', module: 'block', at: [0, 0, 0] },
          { id: 'wing', module: 'block', at: [0, 0, 4] },
        ],
      },
      {
        ...placed('beta', [11.5, 0, 10]),
        modules: [
          { id: 'base', module: 'block', at: [0, 0, 0] },
          { id: 'wing', module: 'block', at: [0, 0, 20] },
        ],
      },
      placed('left_blocker', [8, 0, 14]),
      placed('right_blocker', [13.5, 0, 30]),
    ]);
    const models = await geometryModels();
    const violation = violationOf((await checkGeometry(compiled, models)).violations, 'overlap');
    const move = suggestedMove(violation);
    expect(move.distance).toBe(2);
    expect(
      (
        await checkGeometry(moved(compiled, move.structureId, move.delta), models)
      ).violations.filter((item) => item.kind === 'overlap'),
    ).toEqual([]);
  });
  it('names the overlapping Modules and location when moving their common Structure cannot help', async () => {
    const compiled = fixture([
      {
        ...placed('house', [10, 0, 10]),
        modules: [
          { id: 'left', module: 'block', at: [0, 0, 0] },
          { id: 'right', module: 'block', at: [1.5, 0, 0] },
        ],
      },
    ]);
    const violation = violationOf(
      (await checkGeometry(compiled, await geometryModels())).violations,
      'overlap',
    );
    expectLocation(violation);
    expect(violation.suggestion).toContain('module:house/left');
    expect(violation.suggestion).toContain('module:house/right');
    expect(violation.suggestion).not.toMatch(/Move structure:house (?:east|west|south|north)/i);
  });
  it('falls back to identifying the other Structure and overlap coordinates when five metres cannot clear it', async () => {
    const compiled = fixture(
      [placed('alpha', [10, 0, 10]), placed('beta', [10, 0, 10])],
      [{ id: 'block', size: [12, 2, 12] }],
    );
    const violation = violationOf(
      (await checkGeometry(compiled, await geometryModels({ block: box([12, 2, 12]) }))).violations,
      'overlap',
    );
    const location = expectLocation(violation);
    expect(violation.suggestion).toContain('structure:alpha');
    expect(violation.suggestion).toContain('structure:beta');
    expect(violation.suggestion).toMatch(/\bat\b|\bposition\b|\blocation\b/i);
    expect(violation.suggestion).toContain(String(location[0]));
  });
  it('locates unsupported Modules and advises their actual drop to terrain within three metres', async () => {
    const violation = violationOf(
      (await checkGeometry(fixture([placed('house', [10, 2.5, 10])]), await geometryModels()))
        .violations,
      'unsupported',
    );
    const location = expectLocation(violation);
    expect(location[1]).toBe(2.5);
    expect(violation.suggestion).toMatch(/\bdown\b|\blower\b/i);
    expect(violation.suggestion).toMatch(/\b2\.5\s*(?:m\b|metres\b|meters\b)/i);
  });
  it('advises the distance to a supported Module directly below instead of the more distant terrain', async () => {
    const compiled = fixture([placed('grounded', [10, 0, 10]), placed('floating', [10, 4, 10])]);
    const violation = violationOf(
      (await checkGeometry(compiled, await geometryModels())).violations,
      'unsupported',
    );
    expect(violation.refs).toContain('module:floating/base');
    expect(violation.suggestion).toMatch(/\b2(?:\.0)?\s*(?:m\b|metres\b|meters\b)/i);
    expect(violation.suggestion).toMatch(/\bdown\b|\blower\b/i);
  });
  it('can lower a terrainFollow Module when its Structure has an explicit height', async () => {
    const compiled = fixture(
      [placed('house', [10, 2.5, 10])],
      [{ id: 'block', terrainFollow: true }],
    );
    const violation = violationOf(
      (await checkGeometry(compiled, await geometryModels())).violations,
      'unsupported',
    );
    expect(violation.suggestion).toMatch(/Lower structure:house by 2\.5 m/i);
    expect(violation.suggestion).toMatch(/explicit height to 0 m/i);
  });
  it('names nearby compatible free source and supported target Sockets when lowering cannot help', async () => {
    const compiled = fixture(
      [placed('anchor', [10, 6, 10], 'floating_base'), placed('house', [14, 6, 10])],
      [
        {
          id: 'floating_base',
          canFloat: true,
          sockets: [{ id: 'east', type: 'foundation', position: [2, 1, 1], direction: 'east' }],
        },
        {
          id: 'block',
          sockets: [{ id: 'west', type: 'foundation', position: [0, 1, 1], direction: 'west' }],
        },
      ],
    );
    const violation = violationOf(
      (
        await checkGeometry(
          compiled,
          await geometryModels({ floating_base: box([2, 2, 2]), block: box([2, 2, 2]) }),
        )
      ).violations,
      'unsupported',
    );
    // F18 writes the exact Structure attachment to use instead of naming the Sockets only.
    expect(violation.suggestion).toContain('Attach structure:house to anchor/base.east (2 m away)');
    expect(violation.suggestion).toContain('attach: {socket: base.west, to: anchor/base.east}');
  });
  it('offers canFloat only as an intentional exception when neither lowering nor compatible Sockets help', async () => {
    const violation = violationOf(
      (await checkGeometry(fixture([placed('island', [10, 6, 10])]), await geometryModels()))
        .violations,
      'unsupported',
    );
    expectLocation(violation);
    expect(violation.suggestion).toContain('canFloat');
    expect(violation.suggestion).toContain('true');
  });
  it('does not suggest attaching to another unsupported floating Socket', async () => {
    // Shared by F5 and F18: Sockets on unsupported Modules can never provide Support.
    const compiled = fixture(
      [placed('alpha', [10, 6, 10]), placed('beta', [14, 6, 10])],
      [
        {
          id: 'block',
          sockets: [
            { id: 'east', type: 'foundation', position: [2, 1, 1], direction: 'east' },
            { id: 'west', type: 'foundation', position: [0, 1, 1], direction: 'west' },
          ],
        },
      ],
    );
    const violations = (await checkGeometry(compiled, await geometryModels())).violations;
    expect(violations.filter((item) => item.kind === 'unsupported')).toHaveLength(2);
    for (const violation of violations) {
      expect(violation.suggestion).not.toMatch(/\bAttach\b/);
      expect(violation.suggestion).toContain('canFloat: true');
    }
  });
});

describe('F18 unsupported suggestions inside the same Structure', () => {
  // A wall on the ground and a roof floating 1 m above it, with compatible free Sockets.
  const wallAndRoof: TestModule[] = [
    {
      id: 'wall',
      size: [2, 2, 1],
      sockets: [{ id: 'top', type: 'wall', position: [1, 2, 0.5], direction: 'up' }],
    },
    {
      id: 'roof',
      size: [2, 0.5, 2],
      sockets: [{ id: 'bottom', type: 'roof', position: [1, 0, 0.5], direction: 'down' }],
    },
    // An unsupported obstruction: it blocks the attached roof but cannot support it.
    { id: 'slab', size: [2, 0.5, 2] },
  ];
  const wallAndRoofModels = () =>
    geometryModels({
      wall: box([2, 2, 1]),
      roof: box([2, 0.5, 2]),
      slab: box([2, 0.5, 2]),
      block: box([2, 2, 2]),
    });
  const house = (modules: TestStructure['modules']): TestStructure => ({
    id: 'house',
    position: [10, 10],
    modules,
  });
  const unsupportedOf = (violations: ViolationView[], ref: string): ViolationView => {
    const result = violations.find(
      (violation) => violation.kind === 'unsupported' && violation.refs.includes(ref),
    );
    expect(result, `Expected ${ref} to be unsupported`).toBeDefined();
    return result!;
  };

  it('attaches a floating roof to the free wall Socket below it in the same Structure', async () => {
    const modules = [
      { id: 'wall_n', module: 'wall', at: [0, 0, 0] as Vec3 },
      { id: 'roof', module: 'roof', at: [0, 3, 0] as Vec3 },
    ];
    const models = await wallAndRoofModels();
    const violation = unsupportedOf(
      (await checkGeometry(fixture([house(modules)], wallAndRoof), models)).violations,
      'module:house/roof',
    );
    expect(violation.suggestion).toContain('Attach roof to wall_n.top (1 m below)');
    expect(violation.suggestion).toContain('attach: {socket: bottom, to: wall_n.top}');
    expect(violation.suggestion).not.toContain('canFloat');

    // Applying the advice removes the violation without creating another one.
    const fixed = fixture(
      [
        house([
          modules[0]!,
          { id: 'roof', module: 'roof', attach: { socket: 'bottom', to: 'wall_n.top' } },
        ]),
      ],
      wallAndRoof,
    );
    expect(fixed.scene.violations).toEqual([]);
    expect((await checkGeometry(fixed, models)).violations).toEqual([]);
  });

  it('prefers a clear supported Socket and ignores Sockets on unsupported Modules', async () => {
    const compiled = fixture(
      [
        house([
          { id: 'wall_n', module: 'wall', at: [0, 0, 0] },
          { id: 'wall_far', module: 'wall', at: [0, 0, 3] },
          { id: 'loose_wall', module: 'wall', at: [0, 4.5, 0] },
          { id: 'roof', module: 'roof', at: [0, 3, 3] },
        ]),
      ],
      wallAndRoof,
    );
    const violation = unsupportedOf(
      (await checkGeometry(compiled, await wallAndRoofModels())).violations,
      'module:house/roof',
    );
    expect(violation.suggestion).toContain('Attach roof to wall_far.top (1 m below)');
    expect(violation.suggestion).not.toContain('loose_wall');
  });

  it('still names the compatible Socket instead of canFloat when attaching would overlap', async () => {
    const compiled = fixture(
      [
        house([
          { id: 'wall_n', module: 'wall', at: [0, 0, 0] },
          { id: 'roof', module: 'roof', at: [0, 3, 0] },
          { id: 'blocker', module: 'slab', at: [0, 2, 1] },
        ]),
      ],
      wallAndRoof,
    );
    const violation = unsupportedOf(
      (await checkGeometry(compiled, await wallAndRoofModels())).violations,
      'module:house/roof',
    );
    expect(violation.suggestion).toContain('Attach roof to wall_n.top (1 m below)');
    expect(violation.suggestion).toMatch(/overlap/i);
    expect(violation.suggestion).not.toContain('canFloat');
  });

  it('lowers only the floating Module when it can rest on a supported Module of its Structure', async () => {
    const modules = [
      { id: 'base', module: 'block', at: [0, 0, 0] as Vec3 },
      { id: 'top', module: 'block', at: [0, 3, 0] as Vec3 },
    ];
    const models = await wallAndRoofModels();
    const violation = unsupportedOf(
      (await checkGeometry(fixture([house(modules)]), models)).violations,
      'module:house/top',
    );
    expect(violation.suggestion).toContain('Lower top by 1 m');
    expect(violation.suggestion).toContain('module:house/base');
    expect(violation.suggestion).not.toContain('canFloat');
    const fixed = fixture([house([modules[0]!, { id: 'top', module: 'block', at: [0, 2, 0] }])]);
    expect((await checkGeometry(fixed, models)).violations).toEqual([]);
  });
});

describe('F27 compatible Sockets in the same Structure always beat canFloat', () => {
  const modules: TestModule[] = [
    {
      id: 'wall',
      size: [2, 2, 1],
      sockets: [{ id: 'top', type: 'wall', position: [1, 2, 0.5], direction: 'up' }],
    },
    {
      id: 'roof',
      size: [2, 0.5, 2],
      sockets: [{ id: 'bottom', type: 'roof', position: [1, 0, 0.5], direction: 'down' }],
    },
  ];
  const models = () => geometryModels({ wall: box([2, 2, 1]), roof: box([2, 0.5, 2]) });
  const suggestionFor = (violations: ViolationView[], ref: string): string => {
    const violation = violations.find(
      (item) => item.kind === 'unsupported' && item.refs.includes(ref),
    );
    expect(violation, `Expected ${ref} to be unsupported`).toBeDefined();
    return violation!.suggestion ?? '';
  };

  it('(a) attaches to a Socket whose own Module still needs Support', async () => {
    const compiled = fixture(
      [
        {
          id: 'house',
          position: [10, 10],
          height: 2,
          modules: [
            { id: 'wall_n', module: 'wall', at: [0, 0, 0] },
            { id: 'roof', module: 'roof', at: [0, 3, 0] },
          ],
        },
      ],
      modules,
    );
    const { violations } = await checkGeometry(compiled, await models());
    expect(suggestionFor(violations, 'module:house/wall_n')).toMatch(
      /Lower structure:house by 2 m/,
    );
    const roof = suggestionFor(violations, 'module:house/roof');
    expect(roof).toContain('Attach roof to wall_n.top (1 m below)');
    expect(roof).toContain('wall_n has no Support yet');
    expect(roof).not.toContain('canFloat');
  });

  it('(b) attaches to a compatible Socket of the same Structure beyond 5 m', async () => {
    const compiled = fixture(
      [
        {
          id: 'house',
          position: [10, 10],
          modules: [
            { id: 'wall_n', module: 'wall', at: [0, 0, 0] },
            { id: 'roof', module: 'roof', at: [0, 8, 0] },
          ],
        },
      ],
      modules,
    );
    const { violations } = await checkGeometry(compiled, await models());
    const roof = suggestionFor(violations, 'module:house/roof');
    expect(roof).toContain('Attach roof to wall_n.top (6 m below)');
    expect(roof).not.toContain('canFloat');
  });
});

describe('F36 suggestion quality', () => {
  const suggestionFor = (violations: ViolationView[], ref: string): string => {
    const violation = violations.find(
      (item) => item.kind === 'unsupported' && item.refs.includes(ref),
    );
    expect(violation, `Expected ${ref} to be unsupported`).toBeDefined();
    return violation!.suggestion ?? '';
  };

  it('lowers a Module inside its Structure before attaching the whole Structure elsewhere', async () => {
    // A lamp floats 0.5 m above the edge of a table. A neighbouring post has a compatible free
    // Socket 3 m away, where the whole house would hang clear of everything.
    const compiled = fixture(
      [
        {
          id: 'house',
          position: [10, 10],
          modules: [
            { id: 'table', module: 'table', at: [0, 0, 0] },
            { id: 'lamp', module: 'lamp', at: [1.5, 1.5, 1.5] },
          ],
        },
        placed('post', [14, 0, 13], 'pillar'),
      ],
      [
        { id: 'table', size: [2, 1, 2] },
        {
          id: 'lamp',
          size: [1, 1, 1],
          sockets: [{ id: 'bottom', type: 'floor', position: [1, 0, 1], direction: 'down' }],
        },
        {
          id: 'pillar',
          size: [0.5, 4, 0.5],
          sockets: [{ id: 'top', type: 'floor', position: [0, 4, 0], direction: 'up' }],
        },
      ],
    );
    const { violations } = await checkGeometry(
      compiled,
      await geometryModels({
        table: box([2, 1, 2]),
        lamp: box([1, 1, 1]),
        pillar: box([0.5, 4, 0.5]),
      }),
    );
    const lamp = suggestionFor(violations, 'module:house/lamp');
    expect(lamp).toMatch(/^Lower lamp by 0.5 m/);
    expect(lamp).not.toContain('structure:house to');
  });

  it('says when one free Socket is suggested to several Modules', async () => {
    // Two roof halves float above the same wall, which has one free top Socket.
    const compiled = fixture(
      [
        {
          id: 'house',
          position: [10, 10],
          modules: [
            { id: 'wall_n', module: 'wall', at: [0, 0, 0] },
            { id: 'roof_a', module: 'roof', at: [0, 3, -1] },
            { id: 'roof_b', module: 'roof', at: [0, 3, 1] },
          ],
        },
      ],
      [
        {
          id: 'wall',
          size: [2, 2, 1],
          sockets: [{ id: 'top', type: 'wall', position: [1, 2, 0.5], direction: 'up' }],
        },
        {
          id: 'roof',
          size: [2, 0.5, 2],
          sockets: [{ id: 'bottom', type: 'roof', position: [1, 0, 0.5], direction: 'down' }],
        },
      ],
    );
    const { violations } = await checkGeometry(
      compiled,
      await geometryModels({ wall: box([2, 2, 1]), roof: box([2, 0.5, 2]) }),
    );
    const first = suggestionFor(violations, 'module:house/roof_a');
    const second = suggestionFor(violations, 'module:house/roof_b');
    expect(first).toContain('Attach roof_a to wall_n.top');
    expect(first).not.toContain('also suggested');
    expect(second).toContain('Attach roof_b to wall_n.top');
    expect(second).toContain('wall_n.top is also suggested for module:house/roof_a');
  });

  it('never suggests a move that the map bounds check rejects', async () => {
    // The half block is a 1 m wide model in a 2 m Module: its solid can move east while its
    // Module bounds, which the compiler checks, would leave the map.
    const definitions = [{ id: 'block' }, { id: 'half' }];
    const structures = [placed('a', [98, 0, 10], 'half'), placed('b', [96.5, 0, 10])];
    const compiled = fixture(structures, definitions);
    const { violations } = await checkGeometry(
      compiled,
      await geometryModels({ block: box([2, 2, 2]), half: box([1, 2, 2]) }),
    );
    const overlap = violationOf(violations, 'overlap');
    const move = suggestedMove(overlap);
    const after = fixture(
      structures.map((structure) =>
        structure.id === move.structureId
          ? {
              ...structure,
              position: [
                structure.position[0] + move.delta[0],
                structure.position[1] + move.delta[2],
              ] as [number, number],
            }
          : structure,
      ),
      definitions,
    );
    expect(after.scene.violations.filter((item) => item.kind === 'out_of_bounds')).toEqual([]);
    expect(
      (
        await checkGeometry(
          after,
          await geometryModels({ block: box([2, 2, 2]), half: box([1, 2, 2]) }),
        )
      ).violations.filter((item) => item.kind === 'overlap'),
    ).toEqual([]);
  });
});

describe('F36 suggestion search cost', () => {
  it('checks 2000 Modules whose suggestions weigh many candidate Sockets within the two-second budget', async () => {
    // 1000 supported ground blocks with free top Sockets on a 2 m grid, and 50 floating
    // Structures of 20 blocks, 3.5 m above them: too high to lower, with about ten compatible
    // Sockets within 5 m of every floating block, each attaching a whole Structure.
    const ground = Array.from({ length: 1000 }, (_, index) =>
      placed(
        `g${String(index).padStart(4, '0')}`,
        [2 + (index % 40) * 2, 0, 2 + Math.floor(index / 40) * 2],
        'ground',
      ),
    );
    const floating = Array.from({ length: 50 }, (_, index): TestStructure => ({
      id: `f${String(index).padStart(2, '0')}`,
      position: [2 + (index % 10) * 8, 2 + Math.floor(index / 10) * 10],
      height: 5.5,
      modules: Array.from({ length: 20 }, (_, module) => ({
        id: `m${String(module).padStart(2, '0')}`,
        module: 'float',
        at: [(module % 4) * 2, 0, Math.floor(module / 4) * 2] as Vec3,
      })),
    }));
    const models = await geometryModels({ ground: box([2, 2, 2]), float: box([2, 2, 2]) });
    const start = performance.now();
    const compiled = fixture(
      [...floating, ...ground],
      [
        {
          id: 'ground',
          sockets: [{ id: 'top', type: 'floor', position: [1, 2, 1], direction: 'up' }],
        },
        {
          id: 'float',
          sockets: [{ id: 'bottom', type: 'floor', position: [1, 0, 1], direction: 'down' }],
        },
      ],
    );
    const { violations } = await checkGeometry(compiled, models);
    const elapsed = performance.now() - start;
    expect(compiled.instances).toHaveLength(2000);
    expect(violations.filter((item) => item.kind === 'unsupported')).toHaveLength(1000);
    expect(violations[0]!.suggestion).toMatch(/^Attach structure:f00 to g\d{4}\/base\.top/);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('F37 one Socket address format', () => {
  it('writes attach addresses like the compiler reads them', () => {
    expect(socketAddress('wall_n', 'top')).toBe('wall_n.top');
    expect(socketAddress('wall_n', 'top', 'house')).toBe('house/wall_n.top');
  });
});
