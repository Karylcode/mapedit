import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Vec3, ViolationView } from '@mapedit/protocol';
import { compileMap } from '../src/compiler.js';
import type { Compilation } from '../src/domain.js';
import { parseProject } from '../src/format.js';
import { checkGeometry } from '../src/geometry.js';
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
    expect(violation.suggestion).toContain('module:house/base.west');
    expect(violation.suggestion).toContain('module:anchor/base.east');
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
      expect(violation.suggestion).not.toMatch(/Attach free Socket/i);
      expect(violation.suggestion).toContain('canFloat: true');
    }
  });
});
