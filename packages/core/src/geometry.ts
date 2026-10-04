import type { Manifold, ManifoldToplevel, Mat4 as ManifoldMat4 } from 'manifold-3d';
import type { Vec3, ViolationView } from '@mapedit/protocol';
import type { Bounds, Compilation } from './domain.js';
import { transformPoint } from './math.js';
import { geometryMesh, getManifold, meshGeometry, type ModelGeometry } from './model.js';
import { createViolation } from './violation.js';
import { createGeometryAdvice, type TerrainContact } from './geometry-suggestions.js';
import { supportedFrom } from './support.js';
import {
  fillsBounds,
  GEOMETRY_TOLERANCE,
  intersectsBounds,
  intersectVolume,
  manifoldOverlap,
  MIN_VOLUME,
  overlapLocation,
  restsOn,
  type PlacedSolid,
} from './solid.js';

export { GEOMETRY_TOLERANCE } from './solid.js';
/** Geometry violations, in report order, that receive a searched suggestion. */
export const SEARCHED_ADVICE_LIMIT = 50;
const RECHECK_FOR_ADVICE = `Specific suggestions are searched for the first ${SEARCHED_ADVICE_LIMIT} geometry violations only; fix those, then run check again.`;
export interface GeometryTerrain {
  heightAt(x: number, z: number): number;
  trianglesInBounds?(bounds: Bounds): Iterable<[Vec3, Vec3, Vec3]>;
}
export interface GeometryCheck {
  violations: ViolationView[];
  generated: { owner: string; geometry: ModelGeometry }[];
}
const BUCKET_SIZE = 8;
/** Spatial hash cells, in metres along X and Z, that a box touches within the tolerance. */
function bucketKeys(bounds: Bounds): string[] {
  const keys: string[] = [];
  const first = (value: number) => Math.floor((value - GEOMETRY_TOLERANCE) / BUCKET_SIZE),
    last = (value: number) => Math.floor((value + GEOMETRY_TOLERANCE) / BUCKET_SIZE);
  for (let z = first(bounds.min[2]); z <= last(bounds.max[2]); z++)
    for (let x = first(bounds.min[0]); x <= last(bounds.max[0]); x++) keys.push(`${x},${z}`);
  return keys;
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

function measureTerrainContact(
  library: ManifoldToplevel,
  entry: PlacedSolid,
  triangles: [Vec3, Vec3, Vec3][],
): TerrainContact & { location?: Vec3 } {
  let minimum = Infinity,
    maximum = -Infinity;
  for (const triangle of triangles)
    for (const point of triangle) {
      minimum = Math.min(minimum, point[1]);
      maximum = Math.max(maximum, point[1]);
    }
  const result: TerrainContact & { location?: Vec3 } = { overlap: false, supported: false };
  if (!triangles.length || entry.bounds.min[1] > maximum + GEOMETRY_TOLERANCE) return result;
  if (
    Math.abs(maximum - minimum) < GEOMETRY_TOLERANCE &&
    Math.abs(entry.bounds.min[1] - maximum) <= GEOMETRY_TOLERANCE
  ) {
    result.supported = true;
    return result;
  }
  const allowsBurial =
    entry.instance.definition.isFoundation || entry.instance.definition.terrainFollow;
  const lowered = entry.solid.translate([0, -GEOMETRY_TOLERANCE * 2, 0]);
  try {
    for (const triangle of triangles) {
      if (Math.max(...triangle.map((point) => point[1])) < entry.bounds.min[1] - GEOMETRY_TOLERANCE)
        continue;
      const ground = terrainSolid(library, triangle, Math.min(entry.bounds.min[1], minimum) - 1);
      try {
        if (!result.supported && intersectVolume(lowered, ground) > MIN_VOLUME)
          result.supported = true;
        if (
          !allowsBurial &&
          !result.overlap &&
          entry.bounds.min[1] < maximum - GEOMETRY_TOLERANCE
        ) {
          const location = manifoldOverlap(entry.solid, ground);
          if (location) {
            result.overlap = true;
            result.location = location;
          }
        }
      } finally {
        ground.delete();
      }
      if (result.supported && (result.overlap || allowsBurial)) break;
    }
  } finally {
    lowered.delete();
  }
  return result;
}

/** A footprint skirt, or four square pillars, clipped to the exact terrain surface. */
function foundationExtension(
  library: ManifoldToplevel,
  entry: PlacedSolid,
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
  /** Modules on terrain or marked canFloat; Support spreads from them through links. */
  const supportSeeds = new Set<string>();
  const supportLinks = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const links = supportLinks.get(from) ?? new Set<string>();
    links.add(to);
    supportLinks.set(from, links);
  };
  try {
    const bases = new Map<string, { solid: Manifold; volume: number }>();
    const entries: PlacedSolid[] = [];
    for (const instance of compilation.instances) {
      const geometry = models.get(instance.moduleType);
      if (!geometry) continue;
      let base = bases.get(instance.moduleType);
      if (!base) {
        const solid = keep(new library.Manifold(geometryMesh(library, geometry)));
        base = { solid, volume: solid.volume() };
        bases.set(instance.moduleType, base);
      }
      const solid = keep(base.solid.transform(instance.transform as ManifoldMat4));
      const bounds = solid.boundingBox();
      entries.push({ instance, solid, bounds, box: fillsBounds(base.volume, bounds) });
    }
    for (const entry of entries) {
      const { instance, bounds, solid } = entry;
      if (instance.definition.canFloat) supportSeeds.add(instance.ref);
      const triangles = [...sampledTriangles(terrain, bounds)];
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
          entry.box = fillsBounds(entry.solid.volume(), entry.bounds);
        }
      }
      const contact = measureTerrainContact(library, entry, triangles);
      if (contact.supported) supportSeeds.add(instance.ref);
      if (contact.overlap)
        result.violations.push(
          createViolation({
            kind: 'overlap',
            refs: [instance.ref],
            source: instance.source,
            message: `${instance.ref} overlaps the terrain.`,
            suggestion: `Raise the Structure or use a Foundation or terrain-following Module. ${RECHECK_FOR_ADVICE}`,
            params: { target: 'terrain' },
            location: contact.location,
            rule: 'terrain',
          }),
        );
    }
    const buckets = new Map<string, number[]>(),
      pairs = new Set<string>();
    for (let index = 0; index < entries.length; index++) {
      for (const key of bucketKeys(entries[index]!.bounds)) {
        const occupants = buckets.get(key) ?? [];
        for (const other of occupants) pairs.add(`${other},${index}`);
        occupants.push(index);
        buckets.set(key, occupants);
      }
    }
    for (const pair of pairs) {
      const [ai, bi] = pair.split(',').map(Number),
        a = entries[ai!]!,
        b = entries[bi!]!;
      if (!intersectsBounds(a.bounds, b.bounds, GEOMETRY_TOLERANCE * 3)) continue;
      const aOnB = a.bounds.min[1] >= b.bounds.min[1] - GEOMETRY_TOLERANCE,
        bOnA = b.bounds.min[1] >= a.bounds.min[1] - GEOMETRY_TOLERANCE;
      const location = overlapLocation(a, b);
      if (location) {
        result.violations.push(
          createViolation({
            kind: 'overlap',
            refs: [a.instance.ref, b.instance.ref],
            source: a.instance.source,
            message: `${a.instance.ref} overlaps ${b.instance.ref}.`,
            suggestion: `Move one of the overlapping Structures or change a Module shape. ${RECHECK_FOR_ADVICE}`,
            params: { target: 'module' },
            location,
          }),
        );
        // Overlapping Modules also touch, which is what the downward probes below detect,
        // so link them directly and save two Boolean operations per overlapping pair.
        if (aOnB) link(b.instance.ref, a.instance.ref);
        if (bOnA) link(a.instance.ref, b.instance.ref);
        continue;
      }
      // A tiny downward probe detects physical bottom contact, including sloped surfaces.
      if (aOnB && restsOn(a, b)) link(b.instance.ref, a.instance.ref);
      if (bOnA && restsOn(b, a)) link(a.instance.ref, b.instance.ref);
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
    const supportedModules = supportedFrom(supportSeeds, supportLinks);
    for (const entry of entries)
      if (!supportedModules.has(entry.instance.ref))
        result.violations.push(
          createViolation({
            kind: 'unsupported',
            refs: [entry.instance.ref],
            source: entry.instance.source,
            message: `${entry.instance.ref} has no Support connected to terrain.`,
            params: {},
            suggestion: `Lower it onto terrain or a supported Module, or attach it to a compatible supported Socket. ${RECHECK_FOR_ADVICE}`,
            location: [
              (entry.bounds.min[0] + entry.bounds.max[0]) / 2,
              entry.bounds.min[1],
              (entry.bounds.min[2] + entry.bounds.max[2]) / 2,
            ],
          }),
        );
    if (result.violations.length) {
      const entriesByRef = new Map(entries.map((entry) => [entry.instance.ref, entry]));
      const advice = createGeometryAdvice({
        compilation,
        entries,
        supportSeeds,
        supportLinks,
        tolerance: GEOMETRY_TOLERANCE,
        nearby(bounds) {
          const indices = new Set<number>();
          for (const key of bucketKeys(bounds))
            for (const index of buckets.get(key) ?? []) indices.add(index);
          return [...indices].map((index) => entries[index]!);
        },
        overlaps: (a, b) => overlapLocation(a, b) !== undefined,
        terrainContact: (entry) =>
          measureTerrainContact(library, entry, [...sampledTriangles(terrain, entry.bounds)]),
      });
      // Searches cost Boolean operations, so only the first violations get them; the rest
      // keep the brief suggestion set above until the first ones are fixed.
      for (const issue of result.violations.slice(0, SEARCHED_ADVICE_LIMIT)) {
        const first = entriesByRef.get(issue.refs[0]!)!;
        issue.suggestion =
          issue.kind === 'overlap'
            ? advice.overlap(first, entriesByRef.get(issue.refs[1] ?? ''), issue.location!)
            : advice.unsupported(first);
      }
    }
    return result;
  } finally {
    for (const handle of handles.reverse()) handle.delete();
  }
}
function geometryMaterial(geometry: ModelGeometry): string {
  return geometry.primitives[0]?.material ?? 'white';
}
