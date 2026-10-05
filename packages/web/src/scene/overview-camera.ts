import { MathUtils, Vector3, type PerspectiveCamera } from 'three';

export interface MapSize {
  x: number;
  z: number;
}

/**
 * The overview camera as game-like state: a point on the map it orbits, the
 * compass bearing from that point to the camera (clockwise from north), the
 * pitch above the horizon and the distance.
 */
export class OverviewCamera {
  readonly target = new Vector3();
  bearing = 180;
  pitch = 55;
  distance = 100;
  /** Vertical field of view in degrees. */
  fov = 40;
  minDistance = 2;
  maxDistance = 2000;
  minPitch = 12;
  maxPitch = 89;
  /** How far the target may leave the map, in meters. */
  margin = 20;
  private size: MapSize = { x: 100, z: 100 };

  setMap(size: MapSize): void {
    this.size = size;
    this.margin = Math.max(10, 0.1 * Math.max(size.x, size.z));
    this.maxDistance = Math.max(size.x, size.z) * 1.6;
    this.clamp();
  }

  /** Target and distance that show the whole map. */
  mapFraming(fov: number, aspect = 1): { target: Vector3; distance: number } {
    return {
      target: new Vector3(this.size.x / 2, 0, this.size.z / 2),
      distance: fitDistance(Math.hypot(this.size.x, this.size.z) / 2, fov, aspect) * 0.8,
    };
  }

  /** Look at the whole map from the south, north at the top of the screen. */
  frameMap(fov: number, aspect = 1): void {
    const framing = this.mapFraming(fov, aspect);
    this.target.copy(framing.target);
    this.distance = framing.distance;
    this.bearing = 180;
    this.pitch = 55;
    this.clamp();
  }

  /** Direction from the target to the camera. */
  offset(target = new Vector3()): Vector3 {
    const b = MathUtils.degToRad(this.bearing);
    const p = MathUtils.degToRad(this.pitch);
    return target.set(Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p));
  }

  apply(camera: PerspectiveCamera): void {
    camera.position.copy(this.target).addScaledVector(this.offset(), this.distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.target);
    camera.fov = this.fov;
    camera.near = Math.max(0.05, this.distance * 0.01);
    camera.far = this.distance * 4 + Math.hypot(this.size.x, this.size.z) * 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  clamp(): void {
    this.target.x = MathUtils.clamp(this.target.x, -this.margin, this.size.x + this.margin);
    this.target.z = MathUtils.clamp(this.target.z, -this.margin, this.size.z + this.margin);
    this.distance = MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
    this.pitch = MathUtils.clamp(this.pitch, this.minPitch, this.maxPitch);
    this.bearing = ((this.bearing % 360) + 360) % 360;
  }
}

/** Camera distance at which a sphere fills the narrower field of view. */
export function fitDistance(radius: number, fov: number, aspect = 1): number {
  const vertical = MathUtils.degToRad(fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  return radius / Math.sin(Math.min(vertical, horizontal));
}
