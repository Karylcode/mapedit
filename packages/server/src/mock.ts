import type { SceneSnapshot, Vec3 } from '@mapedit/protocol';

export function matrix(position: Vec3, rotation = 0): number[] {
  const angle = (rotation * Math.PI) / 180;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, ...position, 1];
}

export function mockScene(): SceneSnapshot {
  return {
    protocolVersion: 1,
    revision: 0,
    map: {
      id: 'village',
      name: 'Mock village',
      size: { x: 100, z: 100 },
      sun: { azimuth: 135, elevation: 45 },
    },
    terrain: { revision: 0, chunks: [{ cx: 0, cz: 0, url: '/assets/mock/terrain.glb' }] },
    moduleTypes: [
      {
        id: 'block',
        name: 'Block',
        url: '/assets/mock/block.glb',
        size: [2, 2, 2],
        isFoundation: false,
        canFloat: false,
      },
    ],
    structures: [
      {
        ref: 'structure:house',
        name: 'House',
        file: 'maps/village/structures/house.yaml',
        transform: matrix([10, 0, 10]),
        instances: [
          { ref: 'module:house/base', moduleType: 'block', transform: matrix([10, 0, 10]) },
        ],
      },
    ],
    generated: [],
    markers: [
      {
        ref: 'marker:spawn',
        type: 'spawn',
        shape: { kind: 'point', position: [5, 0, 5], rotation: 0 },
        properties: {},
      },
    ],
    violations: [],
    fileErrors: [],
  };
}

/** Tiny self-contained glTF 2.0 box, used only by the mock server. */
export function boxGlb(size: Vec3 = [2, 2, 2], offset: Vec3 = [0, 0, 0]): Buffer {
  const vertices = new Float32Array(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map(
      (v, i) => v * size[i % 3]! + offset[i % 3]!,
    ),
  );
  const indices = new Uint16Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2,
    6, 1, 6, 5,
  ]);
  const binary = Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(indices.buffer)]);
  const document = {
    asset: { version: '2.0', generator: 'mapedit mock' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: [0.45, 0.65, 0.35, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.byteLength },
      { buffer: 0, byteOffset: vertices.byteLength, byteLength: indices.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: 'VEC3',
        min: offset,
        max: size.map((v, i) => v + offset[i]!),
      },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)]);
  const output = Buffer.alloc(28 + padded.length + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  output.writeUInt32LE(binary.length, 20 + padded.length);
  output.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(output, 28 + padded.length);
  return output;
}
