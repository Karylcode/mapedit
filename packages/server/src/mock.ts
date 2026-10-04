import type { SceneSnapshot, StructureView, Vec3, ViolationView } from '@mapedit/protocol';
import { structureRef, moduleRef, markerRef } from '@mapedit/protocol';
import { transformMatrix } from '@mapedit/core';

export function mockScene(): SceneSnapshot {
  const structure = (
    id: string,
    position: Vec3,
    moduleType = 'block',
    rotation = 0,
  ): StructureView => ({
    ref: structureRef(id),
    name: id,
    file: `maps/village/structures/${id}.yaml`,
    transform: transformMatrix(position, rotation),
    instances: [
      { ref: moduleRef(id, 'base'), moduleType, transform: transformMatrix(position, rotation) },
    ],
  });
  const violation = (
    kind: ViolationView['kind'],
    ids: string[],
    message: string,
    suggestion: string,
    location: Vec3,
  ): ViolationView => ({
    id: `mock:${kind}:${ids.slice().sort().join(',')}`,
    kind,
    message,
    suggestion,
    refs: ids.map((id) => moduleRef(id, 'base')),
    location,
    params: { file: `maps/village/structures/${ids[0]}.yaml`, line: 3 },
  });
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
      {
        id: 'foundation',
        name: 'Foundation',
        url: '/assets/mock/foundation.glb',
        size: [2, 2, 2],
        isFoundation: true,
        canFloat: false,
      },
    ],
    structures: [
      {
        ref: structureRef('house'),
        name: 'House',
        file: 'maps/village/structures/house.yaml',
        transform: transformMatrix([10, 0, 10]),
        instances: [
          {
            ref: moduleRef('house', 'base'),
            moduleType: 'block',
            transform: transformMatrix([10, 0, 10]),
          },
        ],
      },
      structure('raised_foundation', [20, 2, 20], 'foundation'),
      structure('overlap_a', [40, 0, 10]),
      structure('overlap_b', [41.5, 0, 10]),
      structure('unsupported', [50, 2, 10]),
      structure('off_grid', [60.25, 0, 10]),
      structure('bad_rotation', [70, 0, 10], 'block', 7),
      structure('out_of_bounds', [99, 0, 10]),
      structure('missing_reference', [30, 0, 30], 'missing_block'),
      structure('socket_a', [40, 0, 30]),
      structure('socket_b', [42, 0, 30]),
    ],
    generated: [
      {
        owner: moduleRef('raised_foundation', 'base'),
        url: '/assets/mock/foundation-extension.glb',
      },
    ],
    markers: [
      {
        ref: markerRef('spawn'),
        type: 'spawn',
        shape: { kind: 'point', position: [5, 0, 5], rotation: 0 },
        properties: {},
      },
      {
        ref: markerRef('zone'),
        type: 'trigger',
        shape: { kind: 'box', center: [10, 1, 5], size: [4, 2, 4], rotation: 0 },
        properties: { event: 'enter_village' },
      },
    ],
    violations: [
      violation(
        'overlap',
        ['overlap_a', 'overlap_b'],
        'Two blocks overlap by 0.5 m.',
        `Move ${structureRef('overlap_a')} west by 0.5 m to clear the overlap with ${structureRef('overlap_b')}.`,
        [41.75, 1, 11],
      ),
      violation(
        'unsupported',
        ['unsupported'],
        'The block is 2 m above the terrain.',
        `Move ${structureRef('unsupported')} down by 2 m to reach the terrain.`,
        [51, 2, 11],
      ),
      violation(
        'off_grid',
        ['off_grid'],
        'The X coordinate 60.25 is not on the 0.5 m grid.',
        'Set position.x to the nearest grid coordinate, 60.5 m.',
        [60.25, 0, 10],
      ),
      violation(
        'bad_rotation',
        ['bad_rotation'],
        'Rotation 7 degrees is not a multiple of 15.',
        'Set rotation to the nearest valid angle, 0 degrees.',
        [70, 0, 10],
      ),
      violation(
        'out_of_bounds',
        ['out_of_bounds'],
        'The block extends 1 m beyond the east edge.',
        `Move ${structureRef('out_of_bounds')} west by 1 m to fit inside the map.`,
        [100, 1, 11],
      ),
      violation(
        'missing_reference',
        ['missing_reference'],
        'Module missing_block does not exist.',
        'Replace missing_block with the available module block.',
        [30, 0, 30],
      ),
      violation(
        'incompatible_socket',
        ['socket_a', 'socket_b'],
        'The wall socket cannot connect to a foundation socket.',
        'Connect the wall socket to another wall socket instead of a foundation socket.',
        [42, 1, 31],
      ),
    ],
    fileErrors: [
      {
        file: 'maps/village/structures/broken.yaml',
        line: 2,
        message: 'Invalid YAML: close the opening bracket on line 2.',
      },
    ],
  };
}

export function mockAsset(path: string): Buffer | undefined {
  switch (path) {
    case '/assets/mock/block.glb':
    case '/assets/mock/foundation.glb':
      return boxGlb();
    case '/assets/mock/terrain.glb':
      return boxGlb([100, 0.5, 100], [0, -0.5, 0]);
    case '/assets/mock/foundation-extension.glb':
      return boxGlb([2, 2, 2], [20, 0, 20]);
    default:
      return undefined;
  }
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
