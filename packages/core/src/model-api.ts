/** Public model.ts API. Distances are metres; +Y is up, +X east and -Z north. */
export type ModelVec3 = [number, number, number];
export type ModelVec2 = [number, number];
export type Shape =
  | { op: 'box'; size: ModelVec3 }
  | { op: 'cylinder'; radius: number; height: number; segments: number }
  | { op: 'extrude'; polygon: ModelVec2[]; height: number }
  | { op: 'revolve'; profile: ModelVec2[]; segments: number }
  | { op: 'union' | 'difference' | 'intersection'; shapes: Shape[] }
  | { op: 'translate' | 'rotate'; shape: Shape; value: ModelVec3 }
  | { op: 'material'; shape: Shape; id: string };

/** A box from [0,0,0] to size. */
export const box = (size: ModelVec3): Shape => ({ op: 'box', size });
/** A vertical cylinder centred on the Y axis, with its bottom at Y=0. */
export const cylinder = (radius: number, height: number, segments = 32): Shape => ({
  op: 'cylinder',
  radius,
  height,
  segments,
});
/** Extrude a counter-clockwise X/Z polygon upward. */
export const extrude = (polygon: ModelVec2[], height: number): Shape => ({
  op: 'extrude',
  polygon,
  height,
});
/** Revolve a [radius,height] profile around +Y. */
export const revolve = (profile: ModelVec2[], segments = 32): Shape => ({
  op: 'revolve',
  profile,
  segments,
});
export const union = (...shapes: Shape[]): Shape => ({ op: 'union', shapes });
export const difference = (shape: Shape, ...cutters: Shape[]): Shape => ({
  op: 'difference',
  shapes: [shape, ...cutters],
});
export const intersection = (...shapes: Shape[]): Shape => ({ op: 'intersection', shapes });
export const translate = (shape: Shape, value: ModelVec3): Shape => ({
  op: 'translate',
  shape,
  value,
});
/** Euler rotations in degrees, around X, then Y, then Z. */
export const rotate = (shape: Shape, value: ModelVec3): Shape => ({ op: 'rotate', shape, value });
export const material = (id: string, shape: Shape): Shape => ({ op: 'material', id, shape });
