import { Document, WebIO, type Mesh, type Material } from '@gltf-transform/core';
import type { ModelGeometry } from './model.js';
import { getMaterial } from './materials.js';

export interface GlbOptions {
  name?: string;
  extras?: Record<string, unknown>;
  textures?: Readonly<Record<string, Uint8Array>>;
}

/** Add geometry to any document, reusing materials/textures by their stable names. */
export function appendGeometry(
  document: Document,
  geometry: ModelGeometry,
  options: GlbOptions = {},
): Mesh {
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const mesh = document.createMesh(options.name ?? 'Module');
  const resolveMaterial = (id: string): Material => {
    const existing = document
      .getRoot()
      .listMaterials()
      .find((entry) => entry.getName() === id);
    if (existing) return existing;
    const definition = getMaterial(id);
    const result = document
      .createMaterial(id)
      .setBaseColorFactor(definition.color)
      .setMetallicFactor(definition.metallic)
      .setRoughnessFactor(definition.roughness);
    const bytes = definition.texture ? options.textures?.[definition.texture] : undefined;
    if (bytes && definition.texture) {
      const texture =
        document
          .getRoot()
          .listTextures()
          .find((entry) => entry.getName() === definition.texture) ??
        document.createTexture(definition.texture).setImage(bytes).setMimeType('image/jpeg');
      result.setBaseColorTexture(texture);
    }
    return result;
  };
  for (const group of geometry.primitives) {
    if (!group.indices.length) continue;
    const positions: number[] = [],
      normals: number[] = [],
      uv: number[] = [];
    const repeat = getMaterial(group.material).repeatMeters;
    for (let offset = 0; offset < group.indices.length; offset += 3) {
      const vertices = group.indices
        .slice(offset, offset + 3)
        .map((index) => geometry.positions.slice(index * 3, index * 3 + 3));
      const [a, b, c] = vertices as [number[], number[], number[]];
      const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
      const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
      const normal = [
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ];
      const length = Math.hypot(...normal) || 1;
      const unit = normal.map((component) => component / length);
      const dominant =
        Math.abs(unit[1]!) >= Math.abs(unit[0]!) && Math.abs(unit[1]!) >= Math.abs(unit[2]!)
          ? 1
          : Math.abs(unit[0]!) >= Math.abs(unit[2]!)
            ? 0
            : 2;
      // An orthonormal face plane preserves real metres on sloped surfaces too.
      const reference = dominant === 0 ? [0, 0, 1] : [1, 0, 0];
      const dot = reference.reduce((sum, component, axis) => sum + component * unit[axis]!, 0);
      const tangent = reference.map((component, axis) => component - dot * unit[axis]!);
      const tangentLength = Math.hypot(...tangent);
      const uAxis = tangent.map((component) => component / tangentLength);
      const vAxis = [
        uAxis[1]! * unit[2]! - uAxis[2]! * unit[1]!,
        uAxis[2]! * unit[0]! - uAxis[0]! * unit[2]!,
        uAxis[0]! * unit[1]! - uAxis[1]! * unit[0]!,
      ];
      for (const vertex of vertices) {
        positions.push(...vertex);
        normals.push(...unit);
        uv.push(
          vertex.reduce((sum, component, axis) => sum + component * uAxis[axis]!, 0) / repeat,
          vertex.reduce((sum, component, axis) => sum + component * vAxis[axis]!, 0) / repeat,
        );
      }
    }
    const position = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(positions))
      .setBuffer(buffer);
    const normal = document
      .createAccessor()
      .setType('VEC3')
      .setArray(new Float32Array(normals))
      .setBuffer(buffer);
    const texture = document
      .createAccessor()
      .setType('VEC2')
      .setArray(new Float32Array(uv))
      .setBuffer(buffer);
    const indices = document
      .createAccessor()
      .setType('SCALAR')
      .setArray(Uint32Array.from({ length: positions.length / 3 }, (_, index) => index))
      .setBuffer(buffer);
    mesh.addPrimitive(
      document
        .createPrimitive()
        .setAttribute('POSITION', position)
        .setAttribute('NORMAL', normal)
        .setAttribute('TEXCOORD_0', texture)
        .setIndices(indices)
        .setMaterial(resolveMaterial(group.material)),
    );
  }
  return mesh;
}

export async function modelToGlb(
  geometry: ModelGeometry,
  options: GlbOptions = {},
): Promise<Uint8Array> {
  const document = new Document();
  const mesh = appendGeometry(document, geometry, options);
  const node = document
    .createNode(options.name ?? 'Module')
    .setMesh(mesh)
    .setExtras(options.extras ?? { mapedit: { kind: 'module', collider: { type: 'mesh' } } });
  document.createScene('Mapedit').addChild(node);
  return new WebIO().writeBinary(document);
}
