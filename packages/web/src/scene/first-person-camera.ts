import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import type { MapSize, OverviewCamera } from './overview-camera.js';

/** Degrees turned per pixel of mouse movement. */
const LOOK_SPEED = 0.15;
/** Default flying speed in meters per second, close to Minecraft's creative flight. */
export const FLY_SPEED = 11;
/** The slowest and fastest flying speeds the mouse wheel can set. */
export const SPEED_RANGE = { min: 2, max: 120 } as const;
/** The eye never sinks closer to the ground than this, in meters. */
const MIN_CLEARANCE = 0.3;

/**
 * The first-person camera, like flying in Minecraft's creative mode: an eye
 * position, the compass heading it faces (clockwise from north) and the pitch
 * above the horizon. It flies through everything except the ground.
 */
export class FirstPersonCamera {
  readonly position = new Vector3();
  heading = 0;
  pitch = 0;
  /** Meters per second; the mouse wheel changes it. */
  speed = FLY_SPEED;
  /** How far the eye may leave the map, in meters. */
  margin = 50;
  private size: MapSize = { x: 100, z: 100 };

  setMap(size: MapSize): void {
    this.size = size;
    this.margin = Math.max(50, 0.25 * Math.max(size.x, size.z));
  }

  /** Take over where the overview camera is, looking the same way. */
  fromOverview(overview: OverviewCamera): void {
    this.position.copy(overview.target).addScaledVector(overview.offset(), overview.distance);
    this.heading = overview.bearing + 180;
    this.pitch = -overview.pitch;
    this.clamp();
  }

  /**
   * Hand back to the overview camera so the view keeps facing the same way and
   * the overview camera stands right above where the eye was.
   */
  toOverview(overview: OverviewCamera, groundHeight = 0): void {
    overview.bearing = this.heading + 180;
    const reach = overview.distance * Math.cos(MathUtils.degToRad(overview.pitch));
    overview.target
      .copy(this.position)
      .addScaledVector(this.flatForward(), reach)
      .setY(groundHeight);
    overview.clamp();
  }

  /** Mouse movement in pixels: right turns right, up looks up. */
  look(dx: number, dy: number): void {
    this.heading += dx * LOOK_SPEED;
    this.pitch -= dy * LOOK_SPEED;
    this.clamp();
  }

  /** Mouse wheel: scrolling up flies faster, down slower. */
  changeSpeed(deltaY: number): void {
    this.speed = MathUtils.clamp(
      this.speed * Math.exp(-deltaY * 0.002),
      SPEED_RANGE.min,
      SPEED_RANGE.max,
    );
  }

  /**
   * Fly for `seconds`. `forward` and `right` (−1, 0 or 1) move level with the
   * ground whatever the pitch, as in Minecraft; `up` rises or sinks.
   * `ground` gives the terrain height under a position, if known.
   */
  move(
    forward: number,
    right: number,
    up: number,
    seconds: number,
    ground?: (x: number, z: number) => number | undefined,
  ): void {
    const step = new Vector3()
      .addScaledVector(this.flatForward(), forward)
      .addScaledVector(this.flatRight(), right);
    if (step.lengthSq() > 1) step.normalize();
    step.y = up;
    this.position.addScaledVector(step, this.speed * seconds);
    this.clamp();
    const floor = ground?.(this.position.x, this.position.z);
    if (floor !== undefined) this.position.y = Math.max(this.position.y, floor + MIN_CLEARANCE);
  }

  /** The direction the eye looks in. */
  direction(target = new Vector3()): Vector3 {
    const h = MathUtils.degToRad(this.heading);
    const p = MathUtils.degToRad(this.pitch);
    return target.set(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p));
  }

  apply(camera: PerspectiveCamera): void {
    camera.position.copy(this.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(this.direction().add(this.position));
    camera.near = 0.1;
    camera.far = Math.hypot(this.size.x, this.size.z) * 3 + 1000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  clamp(): void {
    this.position.x = MathUtils.clamp(this.position.x, -this.margin, this.size.x + this.margin);
    this.position.z = MathUtils.clamp(this.position.z, -this.margin, this.size.z + this.margin);
    this.pitch = MathUtils.clamp(this.pitch, -89, 89);
    this.heading = ((this.heading % 360) + 360) % 360;
  }

  private flatForward(): Vector3 {
    const h = MathUtils.degToRad(this.heading);
    return new Vector3(Math.sin(h), 0, -Math.cos(h));
  }

  private flatRight(): Vector3 {
    const h = MathUtils.degToRad(this.heading);
    return new Vector3(Math.cos(h), 0, Math.sin(h));
  }
}
