import type { Mat4, Vec3 } from '@mapedit/protocol';
import type { Socket, SocketType } from './domain.js';
import {
  clean,
  compareText,
  directionVector,
  EPSILON,
  normalizeRotation,
  transformMatrix,
  transformPoint,
  yawOf,
} from './math.js';

/** A Socket as attach writes it: `instance.socket`, or `structure/instance.socket` across Structures. */
export function socketAddress(instanceId: string, socketId: string, structureId?: string): string {
  return `${structureId ? `${structureId}/` : ''}${instanceId}.${socketId}`;
}

/** A Socket definition together with the transform of the frame that owns it. */
export interface SocketPose {
  socket: Socket;
  transform: Mat4;
}

/**
 * Solve the frame transform that makes `own` meet `target`: positions coincide and
 * directions face each other. The result is expressed in the frame of `target.transform`.
 * `facing` is false when a vertical Socket cannot face the other one with a Y rotation.
 */
export function socketAttachment(
  own: SocketPose,
  target: SocketPose,
): { transform: Mat4; facing: boolean } {
  const ownDirection = directionVector(
    own.socket.direction,
    own.socket.rotation + yawOf(own.transform),
  );
  const targetDirection = directionVector(
    target.socket.direction,
    target.socket.rotation + yawOf(target.transform),
  );
  let yaw: number,
    facing = true;
  if (Math.abs(ownDirection[1]) > EPSILON || Math.abs(targetDirection[1]) > EPSILON) {
    facing =
      Math.abs(ownDirection[1] + targetDirection[1]) <= EPSILON &&
      Math.abs(ownDirection[1]) >= EPSILON;
    yaw =
      yawOf(target.transform) + target.socket.rotation - yawOf(own.transform) - own.socket.rotation;
  } else
    yaw =
      (Math.atan2(targetDirection[0], targetDirection[2]) * 180) / Math.PI +
      180 -
      (Math.atan2(ownDirection[0], ownDirection[2]) * 180) / Math.PI;
  yaw = normalizeRotation(yaw);
  const ownPoint = transformPoint(own.transform, own.socket.position),
    targetPoint = transformPoint(target.transform, target.socket.position);
  const rotated = transformPoint(transformMatrix([0, 0, 0], yaw), ownPoint);
  return {
    transform: transformMatrix(targetPoint.map((n, i) => clean(n - rotated[i]!)) as Vec3, yaw),
    facing,
  };
}

/** Compatibility is symmetric: either declared direction permits a connection. */
export function socketTypesCompatible(
  types: Readonly<Record<string, SocketType>>,
  a: string,
  b: string,
): boolean {
  return Boolean(types[a]?.compatibleWith.includes(b) || types[b]?.compatibleWith.includes(a));
}

export function compatibleSocketTypes(
  types: Readonly<Record<string, SocketType>>,
  type: string,
): string[] {
  return Object.keys(types)
    .filter((other) => socketTypesCompatible(types, type, other))
    .sort(compareText);
}
