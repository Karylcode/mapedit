import { Document, WebIO, type mat4, type Mesh } from '@gltf-transform/core';
import { parseObjectRef, type Mat4, type Vec3 } from '@mapedit/protocol';
import type { Compilation } from './domain.js';
import type { ModelGeometry } from './model.js';
import { appendGeometry } from './glb.js';
import {
  appendTerrainChunk,
  terrainChunks,
  terrainHeightAt,
  terrainTriangles,
  type TerrainData,
} from './terrain.js';
import { multiplyMatrices, transformMatrix } from './math.js';
import { checkGeometry, GEOMETRY_TOLERANCE } from './geometry.js';

export interface ExportInput {
  compilation: Compilation;
  models: ReadonlyMap<string, ModelGeometry>;
  terrain: TerrainData;
  /** Accepted for compatibility; extensions are recomputed against the exported terrain. */
  generated?: { owner: string; geometry: ModelGeometry }[];
  textures?: Readonly<Record<string, Uint8Array>>;
}

function inverseRigid(matrix: Mat4): Mat4 {
  const result = [
    matrix[0]!,
    matrix[4]!,
    matrix[8]!,
    0,
    matrix[1]!,
    matrix[5]!,
    matrix[9]!,
    0,
    matrix[2]!,
    matrix[6]!,
    matrix[10]!,
    0,
    0,
    0,
    0,
    1,
  ];
  for (let row = 0; row < 3; row++)
    result[row + 12] = -(
      result[row]! * matrix[12]! +
      result[row + 4]! * matrix[13]! +
      result[row + 8]! * matrix[14]!
    );
  return result;
}

/** Export the checked map as one self-contained, engine-neutral GLB. */
export async function exportMapGlb(input: ExportInput): Promise<Uint8Array> {
  const { scene } = input.compilation;
  if (scene.violations.length || scene.fileErrors.length)
    throw new Error(
      `Export refused: ${scene.violations.length} violations and ${scene.fileErrors.length} file errors. Run check and fix them first.`,
    );
  for (const instance of scene.structures.flatMap((structure) => structure.instances)) {
    const geometry = input.models.get(instance.moduleType);
    if (!geometry)
      throw new Error(`Export refused: no built geometry for module '${instance.moduleType}'.`);
    const definition = input.compilation.instances.find(
      (compiled) => compiled.ref === instance.ref,
    )?.definition;
    if (!definition)
      throw new Error(`Export refused: no compiled definition for '${instance.ref}'.`);
    if (
      [0, 1, 2].some(
        (axis) =>
          geometry.bounds.min[axis]! < -GEOMETRY_TOLERANCE ||
          geometry.bounds.max[axis]! > definition.size[axis]! + GEOMETRY_TOLERANCE,
      )
    )
      throw new Error(
        `Export refused: geometry exceeds the declared size of module '${instance.moduleType}'.`,
      );
  }
  const checked = await checkGeometry(input.compilation, input.models, {
    heightAt: (x, z) => terrainHeightAt(input.terrain, x, z),
    trianglesInBounds: (bounds) => terrainTriangles(input.terrain, bounds),
  });
  if (checked.violations.length)
    throw new Error(
      `Export refused: ${checked.violations.length} geometry violations. ${checked.violations[0]!.message} Run check and fix them first.`,
    );
  const doc = new Document();
  const map = doc.createNode(scene.map.id).setExtras({
    mapedit: {
      version: 1,
      kind: 'map',
      id: scene.map.id,
      units: 'meters',
      size: scene.map.size,
      sun: scene.map.sun,
    },
  });
  doc.createScene(scene.map.name).addChild(map);
  const terrain = doc.createNode('Terrain').setExtras({ mapedit: { kind: 'terrainGroup' } });
  map.addChild(terrain);
  for (const chunk of terrainChunks(input.terrain)) {
    terrain.addChild(
      doc
        .createNode(`terrain_${chunk.cx}_${chunk.cz}`)
        .setMesh(appendTerrainChunk(doc, chunk))
        .setExtras({ mapedit: { kind: 'terrain', collider: { type: 'mesh' } } }),
    );
  }
  const meshes = new Map<string, Mesh>();
  for (const structure of scene.structures) {
    const structureReference = parseObjectRef(structure.ref);
    if (structureReference?.kind !== 'structure')
      throw new Error(`Export refused: invalid Structure reference '${structure.ref}'.`);
    const node = doc
      .createNode(structureReference.structureId)
      .setMatrix(structure.transform as mat4)
      .setExtras({ mapedit: { kind: 'structure', ref: structure.ref, source: structure.file } });
    map.addChild(node);
    const inverse = inverseRigid(structure.transform);
    for (const instance of structure.instances) {
      const instanceReference = parseObjectRef(instance.ref);
      if (instanceReference?.kind !== 'module')
        throw new Error(`Export refused: invalid Module reference '${instance.ref}'.`);
      let mesh = meshes.get(instance.moduleType);
      if (!mesh) {
        const geometry = input.models.get(instance.moduleType);
        if (!geometry)
          throw new Error(`Export refused: no built geometry for module '${instance.moduleType}'.`);
        mesh = appendGeometry(doc, geometry, {
          name: instance.moduleType,
          textures: input.textures,
        });
        meshes.set(instance.moduleType, mesh);
      }
      node.addChild(
        doc
          .createNode(instanceReference.instanceId)
          .setMesh(mesh)
          .setMatrix(multiplyMatrices(inverse, instance.transform) as mat4)
          .setExtras({
            mapedit: {
              kind: 'module',
              ref: instance.ref,
              moduleType: instance.moduleType,
              collider: { type: 'mesh' },
            },
          }),
      );
    }
  }
  for (const generated of checked.generated) {
    map.addChild(
      doc
        .createNode(`${generated.owner}/foundation`)
        .setMesh(appendGeometry(doc, generated.geometry, { textures: input.textures }))
        .setExtras({
          mapedit: { kind: 'foundation', owner: generated.owner, collider: { type: 'mesh' } },
        }),
    );
  }
  const markers = doc.createNode('Markers');
  map.addChild(markers);
  for (const marker of scene.markers) {
    const markerReference = parseObjectRef(marker.ref);
    if (markerReference?.kind !== 'marker')
      throw new Error(`Export refused: invalid Marker reference '${marker.ref}'.`);
    const position: Vec3 =
      marker.shape.kind === 'point' ? marker.shape.position : marker.shape.center;
    const extras = {
      kind: 'marker',
      ref: marker.ref,
      markerType: marker.type,
      properties: marker.properties,
      shape:
        marker.shape.kind === 'point'
          ? { kind: 'point' }
          : { kind: 'box', size: marker.shape.size },
      ...(marker.shape.kind === 'box'
        ? { collider: { type: 'box', size: marker.shape.size, isTrigger: true } }
        : {}),
    };
    markers.addChild(
      doc
        .createNode(markerReference.markerId)
        .setMatrix(transformMatrix(position, marker.shape.rotation) as mat4)
        .setExtras({ mapedit: extras }),
    );
  }
  return new WebIO().writeBinary(doc);
}
