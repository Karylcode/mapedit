import initializeManifold, { type Manifold, type ManifoldToplevel, type Mesh } from 'manifold-3d';
import type { Vec3 } from '@mapedit/protocol';
import type { Shape } from './model-api.js';
import { getMaterial } from './materials.js';

export interface GeometryPrimitive {
  material: string;
  indices: number[];
}
/** JSON-safe geometry; the closed indexed mesh is also the exact collider. */
export interface ModelGeometry {
  positions: number[];
  indices: number[];
  primitives: GeometryPrimitive[];
  bounds: { min: Vec3; max: Vec3 };
  volume: number;
}

let manifoldPromise: Promise<ManifoldToplevel> | undefined;
export function getManifold(): Promise<ManifoldToplevel> {
  manifoldPromise ??= initializeManifold().then((library) => {
    library.setup();
    return library;
  });
  return manifoldPromise;
}

export function meshGeometry(
  solid: Manifold,
  materials: ReadonlyMap<number, string> = new Map(),
  fallback = 'white',
): ModelGeometry {
  const mesh = solid.getMesh();
  const positions: number[] = [];
  for (let vertex = 0; vertex < mesh.numVert; vertex++) {
    for (let axis = 0; axis < 3; axis++)
      positions.push(mesh.vertProperties[vertex * mesh.numProp + axis]!);
  }
  const byMaterial = new Map<string, number[]>();
  for (let run = 0; run < mesh.runOriginalID.length; run++) {
    const id = materials.get(mesh.runOriginalID[run]!) ?? fallback;
    const indices = byMaterial.get(id) ?? [];
    for (let index = mesh.runIndex[run]!; index < mesh.runIndex[run + 1]!; index++)
      indices.push(mesh.triVerts[index]!);
    byMaterial.set(id, indices);
  }
  if (byMaterial.size === 0) byMaterial.set(fallback, Array.from(mesh.triVerts));
  return {
    positions,
    indices: Array.from(mesh.triVerts),
    primitives: [...byMaterial].map(([material, indices]) => ({ material, indices })),
    bounds: solid.boundingBox(),
    volume: solid.volume(),
  };
}

export function geometryMesh(library: ManifoldToplevel, geometry: ModelGeometry): Mesh {
  return new library.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(geometry.positions),
    triVerts: new Uint32Array(geometry.indices),
  });
}

/** Validate before invoking WASM. Limits bound hostile recipes and accidental complexity. */
export function validateShape(value: unknown): asserts value is Shape {
  let operations = 0;
  const number = (n: unknown, positive = false): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000 && (!positive || n > 0);
  const vector = (v: unknown, count: number, positive = false): boolean =>
    Array.isArray(v) && v.length === count && v.every((n) => number(n, positive));
  const polygon = (v: unknown): boolean =>
    Array.isArray(v) && v.length >= 3 && v.length <= 512 && v.every((p) => vector(p, 2));
  const check = (v: unknown, depth: number): void => {
    if (++operations > 4096 || depth > 128)
      throw new Error('Model exceeds the 4096-operation or 128-level complexity limit.');
    if (!v || typeof v !== 'object')
      throw new Error('Model must export a shape from @mapedit/model.');
    const item = v as Record<string, unknown>;
    let valid: boolean;
    switch (item.op) {
      case 'box':
        valid = vector(item.size, 3, true);
        break;
      case 'cylinder':
        valid =
          number(item.radius, true) &&
          number(item.height, true) &&
          Number.isInteger(item.segments) &&
          Number(item.segments) >= 3 &&
          Number(item.segments) <= 256;
        break;
      case 'extrude':
        valid = polygon(item.polygon) && number(item.height, true);
        break;
      case 'revolve':
        valid =
          polygon(item.profile) &&
          Number.isInteger(item.segments) &&
          Number(item.segments) >= 3 &&
          Number(item.segments) <= 256;
        break;
      case 'union':
      case 'difference':
      case 'intersection':
        valid = Array.isArray(item.shapes) && item.shapes.length > 0 && item.shapes.length <= 1024;
        if (valid) for (const shape of item.shapes as unknown[]) check(shape, depth + 1);
        break;
      case 'translate':
      case 'rotate':
        valid = vector(item.value, 3);
        check(item.shape, depth + 1);
        break;
      case 'material':
        valid = typeof item.id === 'string';
        if (valid) getMaterial(String(item.id));
        check(item.shape, depth + 1);
        break;
      default:
        valid = false;
    }
    if (!valid)
      throw new Error(
        `Invalid '${String(item.op)}' shape parameters. Use finite metre values and supported shape operations.`,
      );
  };
  check(value, 0);
}

export async function buildModel(
  shape: unknown,
  size?: Vec3,
  defaultMaterial = 'white',
): Promise<ModelGeometry> {
  validateShape(shape);
  getMaterial(defaultMaterial);
  const library = await getManifold();
  const handles: Manifold[] = [];
  const materials = new Map<number, string>();
  const keep = (solid: Manifold): Manifold => {
    handles.push(solid);
    return solid;
  };
  const evaluate = (node: Shape, inherited: string): Manifold => {
    let solid: Manifold;
    switch (node.op) {
      case 'box':
        solid = keep(library.Manifold.cube(node.size));
        break;
      case 'cylinder':
        solid = keep(
          keep(
            library.Manifold.cylinder(node.height, node.radius, node.radius, node.segments),
          ).rotate([-90, 0, 0]),
        );
        break;
      case 'extrude':
        // Rotate +Z to +Y and invert input Z so the polygon keeps its X/Z coordinates.
        solid = keep(
          keep(
            library.Manifold.extrude(
              [node.polygon.map(([x, z]): [number, number] => [x, -z]).reverse()],
              node.height,
            ),
          ).rotate([-90, 0, 0]),
        );
        break;
      case 'revolve':
        solid = keep(
          keep(library.Manifold.revolve([node.profile], node.segments)).rotate([-90, 0, 0]),
        );
        break;
      case 'translate':
        return keep(evaluate(node.shape, inherited).translate(node.value));
      case 'rotate':
        return keep(evaluate(node.shape, inherited).rotate(node.value));
      case 'material':
        return evaluate(node.shape, node.id);
      case 'union':
        return keep(library.Manifold.union(node.shapes.map((child) => evaluate(child, inherited))));
      case 'difference': {
        const children = node.shapes.map((child) => evaluate(child, inherited));
        return keep(library.Manifold.difference(children));
      }
      case 'intersection':
        return keep(
          library.Manifold.intersection(node.shapes.map((child) => evaluate(child, inherited))),
        );
    }
    const original = keep(solid.asOriginal());
    materials.set(original.originalID(), inherited);
    return original;
  };
  try {
    const solid = evaluate(shape, defaultMaterial);
    if (solid.status() !== 'NoError' || solid.isEmpty())
      throw new Error('Model produced an empty or invalid solid.');
    if (solid.numTri() > 100000) throw new Error('Model exceeds the 100000-triangle limit.');
    const result = meshGeometry(solid, materials, defaultMaterial);
    if (
      size &&
      [0, 1, 2].some(
        (axis) =>
          result.bounds.min[axis]! < -0.0001 || result.bounds.max[axis]! > size[axis]! + 0.0001,
      )
    ) {
      throw new Error(
        `Model geometry exceeds module.yaml size [${size.join(', ')}]. Keep the shape between [0, 0, 0] and the declared size.`,
      );
    }
    return result;
  } finally {
    for (const handle of handles.reverse()) handle.delete();
  }
}
