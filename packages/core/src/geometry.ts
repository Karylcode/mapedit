import type { Manifold, ManifoldToplevel, Mat4 as ManifoldMat4 } from 'manifold-3d';
import type { Vec3, ViolationView } from '@mapedit/protocol';
import type { Bounds, Compilation, CompiledInstance } from './domain.js';
import { transformPoint } from './math.js';
import { geometryMesh, getManifold, meshGeometry, type ModelGeometry } from './model.js';
import { violationId } from './violation.js';

export const GEOMETRY_TOLERANCE = 0.0001;
const MIN_VOLUME = 1e-9;
export interface GeometryTerrain {
  heightAt(x: number, z: number): number;
  trianglesInBounds?(bounds: Bounds): Iterable<[Vec3, Vec3, Vec3]>;
}
export interface GeometryCheck {
  violations: ViolationView[];
  generated: { owner: string; geometry: ModelGeometry }[];
}
interface SolidInstance {
  instance: CompiledInstance;
  solid: Manifold;
  bounds: Bounds;
}

function intersectsBounds(a: Bounds, b: Bounds, margin = 0): boolean {
  return [0, 1, 2].every(
    (axis) => a.max[axis]! + margin > b.min[axis]! && b.max[axis]! + margin > a.min[axis]!,
  );
}
function intersectVolume(a: Manifold, b: Manifold): number {
  const intersection = a.intersect(b);
  try {
    return intersection.volume();
  } finally {
    intersection.delete();
  }
}
function* sampledTriangles(terrain: GeometryTerrain, bounds: Bounds): Iterable<[Vec3, Vec3, Vec3]> {
  if (terrain.trianglesInBounds) {
    yield* terrain.trianglesInBounds(bounds);
    return;
  }
  for (let z = Math.floor(bounds.min[2]); z < Math.ceil(bounds.max[2]); z++) {
    for (let x = Math.floor(bounds.min[0]); x < Math.ceil(bounds.max[0]); x++) {
      const nw: Vec3 = [x, terrain.heightAt(x, z), z],
        ne: Vec3 = [x + 1, terrain.heightAt(x + 1, z), z];
      const sw: Vec3 = [x, terrain.heightAt(x, z + 1), z + 1],
        se: Vec3 = [x + 1, terrain.heightAt(x + 1, z + 1), z + 1];
      yield [nw, sw, se];
      yield [nw, se, ne];
    }
  }
}
function terrainSolid(
  library: ManifoldToplevel,
  triangle: [Vec3, Vec3, Vec3],
  bottom: number,
): Manifold {
  return library.Manifold.hull([...triangle, ...triangle.map(([x, , z]): Vec3 => [x, bottom, z])]);
}

/** A footprint skirt, or four square pillars, clipped to the exact terrain surface. */
function foundationExtension(
  library: ManifoldToplevel,
  entry: SolidInstance,
  triangles: [Vec3, Vec3, Vec3][],
): Manifold | undefined {
  const base = entry.bounds.min[1];
  const minimum = Math.min(...triangles.flatMap((triangle) => triangle.map((point) => point[1])));
  if (!Number.isFinite(minimum) || minimum >= base - GEOMETRY_TOLERANCE) return undefined;
  const handles: Manifold[] = [];
  const keep = (value: Manifold): Manifold => {
    handles.push(value);
    return value;
  };
  let extension: Manifold;
  try {
    if (entry.instance.definition.foundationStyle === 'pillars') {
      const size = entry.instance.size,
        width = Math.min(0.25, size[0] / 4, size[2] / 4);
      const pillars = [0, size[0] - width].flatMap((x) =>
        [0, size[2] - width].map((z) => {
          const position = transformPoint(entry.instance.transform, [x, 0, z]);
          const cube = keep(library.Manifold.cube([width, base - minimum, width]));
          const rotation =
            (Math.atan2(entry.instance.transform[8]!, entry.instance.transform[10]!) * 180) /
            Math.PI;
          return keep(
            keep(cube.rotate([0, rotation, 0])).translate([position[0], minimum, position[2]]),
          );
        }),
      );
      extension = keep(library.Manifold.union(pillars));
    } else {
      const rotated = keep(entry.solid.rotate([90, 0, 0]));
      const footprint = rotated.project();
      try {
        extension = keep(
          keep(
            keep(library.Manifold.extrude(footprint, base - minimum)).rotate([-90, 0, 0]),
          ).translate([0, minimum, 0]),
        );
      } finally {
        footprint.delete();
      }
    }
    const grounds = triangles.map((triangle) => keep(terrainSolid(library, triangle, minimum - 1)));
    const ground = keep(library.Manifold.union(grounds));
    const clipped = extension.subtract(ground);
    if (clipped.volume() <= MIN_VOLUME) {
      clipped.delete();
      return undefined;
    }
    return clipped;
  } finally {
    for (const handle of handles.reverse()) handle.delete();
  }
}

/** Exact solid checks after a spatial hash broad phase; touching is not overlapping. */
export async function checkGeometry(
  compilation: Compilation,
  models: ReadonlyMap<string, ModelGeometry>,
  terrain: GeometryTerrain = { heightAt: () => 0 },
): Promise<GeometryCheck> {
  const library = await getManifold();
  const handles: Manifold[] = [];
  const keep = (value: Manifold): Manifold => {
    handles.push(value);
    return value;
  };
  const result: GeometryCheck = { violations: [], generated: [] };
  const instancesByRef = new Map(compilation.instances.map((instance) => [instance.ref, instance]));
  const supported = new Set<string>();
  const supportLinks = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const links = supportLinks.get(from) ?? new Set<string>();
    links.add(to);
    supportLinks.set(from, links);
  };
  const violation = (
    kind: 'overlap' | 'unsupported',
    refs: string[],
    message: string,
    suggestion: string,
    params: Record<string, unknown> = {},
  ): void => {
    const source = instancesByRef.get(refs[0]!)?.source;
    result.violations.push({
      id: violationId({ kind, refs, rule: params.terrain === true ? 'terrain' : '' }),
      kind,
      refs,
      message,
      suggestion,
      params: { ...(source ? { file: source.file, line: source.line } : {}), ...params },
    });
  };
  try {
    const bases = new Map<string, Manifold>();
    const entries: SolidInstance[] = [];
    for (const instance of compilation.instances) {
      const geometry = models.get(instance.moduleType);
      if (!geometry) continue;
      let base = bases.get(instance.moduleType);
      if (!base) {
        base = keep(new library.Manifold(geometryMesh(library, geometry)));
        bases.set(instance.moduleType, base);
      }
      const solid = keep(base.transform(instance.transform as ManifoldMat4));
      entries.push({ instance, solid, bounds: solid.boundingBox() });
    }
    for (const entry of entries) {
      const { instance, bounds, solid } = entry;
      if (instance.definition.canFloat) supported.add(instance.ref);
      const triangles = [...sampledTriangles(terrain, bounds)];
      const heights = triangles.flatMap((triangle) => triangle.map((point) => point[1]));
      const maximum = Math.max(...heights),
        minimum = Math.min(...heights);
      if (instance.definition.isFoundation) {
        const extension = foundationExtension(library, entry, triangles);
        if (extension) {
          keep(extension);
          result.generated.push({
            owner: instance.ref,
            geometry: meshGeometry(
              extension,
              new Map(),
              instance.definition.material ?? geometryMaterial(models.get(instance.moduleType)!),
            ),
          });
          // The extension participates in physical collision and support too.
          entry.solid = keep(solid.add(extension));
          entry.bounds = entry.solid.boundingBox();
        }
      }
      if (
        !triangles.length ||
        (bounds.min[1] > maximum + GEOMETRY_TOLERANCE && !instance.definition.isFoundation)
      )
        continue;
      if (
        Math.abs(maximum - minimum) < GEOMETRY_TOLERANCE &&
        Math.abs(entry.bounds.min[1] - maximum) <= GEOMETRY_TOLERANCE
      ) {
        supported.add(instance.ref);
        continue;
      }
      let groundContact = false,
        terrainOverlap = false;
      const lowered = keep(entry.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]));
      for (const triangle of triangles) {
        if (
          Math.max(...triangle.map((point) => point[1])) <
          entry.bounds.min[1] - GEOMETRY_TOLERANCE
        )
          continue;
        const ground = terrainSolid(library, triangle, Math.min(entry.bounds.min[1], minimum) - 1);
        try {
          if (!groundContact && intersectVolume(lowered, ground) > MIN_VOLUME) groundContact = true;
          if (
            !instance.definition.isFoundation &&
            !instance.definition.terrainFollow &&
            !terrainOverlap &&
            entry.bounds.min[1] < maximum - GEOMETRY_TOLERANCE &&
            intersectVolume(entry.solid, ground) > MIN_VOLUME
          )
            terrainOverlap = true;
        } finally {
          ground.delete();
        }
      }
      if (groundContact) supported.add(instance.ref);
      if (terrainOverlap)
        violation(
          'overlap',
          [instance.ref],
          `${instance.ref} overlaps the terrain.`,
          'Raise the Structure or use a Foundation or terrain-following Module.',
          { terrain: true },
        );
    }
    const buckets = new Map<string, number[]>(),
      pairs = new Set<string>();
    const cell = 8;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!,
        bounds = entry.bounds;
      for (
        let z = Math.floor((bounds.min[2] - GEOMETRY_TOLERANCE) / cell);
        z <= Math.floor((bounds.max[2] + GEOMETRY_TOLERANCE) / cell);
        z++
      ) {
        for (
          let x = Math.floor((bounds.min[0] - GEOMETRY_TOLERANCE) / cell);
          x <= Math.floor((bounds.max[0] + GEOMETRY_TOLERANCE) / cell);
          x++
        ) {
          const key = `${x},${z}`,
            occupants = buckets.get(key) ?? [];
          for (const other of occupants) pairs.add(`${other},${index}`);
          occupants.push(index);
          buckets.set(key, occupants);
        }
      }
    }
    for (const pair of pairs) {
      const [ai, bi] = pair.split(',').map(Number),
        a = entries[ai!]!,
        b = entries[bi!]!;
      if (!intersectsBounds(a.bounds, b.bounds, GEOMETRY_TOLERANCE * 3)) continue;
      if (
        intersectsBounds(a.bounds, b.bounds, -GEOMETRY_TOLERANCE) &&
        intersectVolume(a.solid, b.solid) > MIN_VOLUME
      ) {
        violation(
          'overlap',
          [a.instance.ref, b.instance.ref],
          `${a.instance.ref} overlaps ${b.instance.ref}.`,
          'Move one Structure by 0.5 metres or change its Module shape.',
        );
      }
      // A tiny downward probe detects physical bottom contact, including sloped surfaces.
      if (a.bounds.min[1] >= b.bounds.min[1] - GEOMETRY_TOLERANCE) {
        const probe = a.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]);
        try {
          if (intersectVolume(probe, b.solid) > MIN_VOLUME) link(b.instance.ref, a.instance.ref);
        } finally {
          probe.delete();
        }
      }
      if (b.bounds.min[1] >= a.bounds.min[1] - GEOMETRY_TOLERANCE) {
        const probe = b.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]);
        try {
          if (intersectVolume(probe, a.solid) > MIN_VOLUME) link(a.instance.ref, b.instance.ref);
        } finally {
          probe.delete();
        }
      }
    }
    for (const connection of compilation.socketConnections) {
      link(connection.a, connection.b);
      link(connection.b, connection.a);
    }
    for (const entry of entries) {
      if (entry.instance.attachTo) {
        link(entry.instance.attachTo, entry.instance.ref);
        link(entry.instance.ref, entry.instance.attachTo);
      }
    }
    const queue = [...supported];
    for (let i = 0; i < queue.length; i++)
      for (const next of supportLinks.get(queue[i]!) ?? []) {
        if (!supported.has(next)) {
          supported.add(next);
          queue.push(next);
        }
      }
    for (const entry of entries)
      if (!supported.has(entry.instance.ref))
        violation(
          'unsupported',
          [entry.instance.ref],
          `${entry.instance.ref} has no Support connected to terrain.`,
          'Lower the Structure, add a Foundation, or connect to a supported Module.',
        );
    return result;
  } finally {
    for (const handle of handles.reverse()) handle.delete();
  }
}
function geometryMaterial(geometry: ModelGeometry): string {
  return geometry.primitives[0]?.material ?? 'white';
}
