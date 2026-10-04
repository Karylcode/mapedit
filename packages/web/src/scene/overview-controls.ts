import { MathUtils, Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { OverviewCamera } from './overview-camera.js';

/** Degrees of orbit per pixel dragged. */
const ORBIT_SPEED = 0.3;
/** Fraction of the camera distance panned per second by the keyboard. */
const KEY_PAN_SPEED = 0.9;

export interface Ground {
  /** Where a ray meets the terrain (or the ground plane). */
  groundPoint(raycaster: Raycaster): Vector3 | undefined;
  /** Terrain height at a map position, if known. */
  heightAt(x: number, z: number): number | undefined;
}

/**
 * Game-style overview camera moves. Pointer positions are normalized device
 * coordinates (−1…1, +y up), so the logic does not depend on the page.
 */
export class OverviewControls {
  private readonly raycaster = new Raycaster();
  private grab?: { plane: Plane; point: Vector3 };
  private tween?: { from: Snapshot; to: Snapshot; elapsed: number; duration: number };

  constructor(
    readonly overview: OverviewCamera,
    readonly camera: PerspectiveCamera,
    readonly ground: Ground,
  ) {}

  /** Right-drag: turn around the target and tilt; the map follows the pointer. */
  orbit(dx: number, dy: number): void {
    this.stop();
    this.overview.bearing += dx * ORBIT_SPEED;
    this.overview.pitch += dy * ORBIT_SPEED;
    this.overview.clamp();
  }

  /** Middle-drag start: remember the ground point under the pointer. */
  beginPan(pointer: Vector2): void {
    this.stop();
    this.sync();
    const plane = new Plane(new Vector3(0, 1, 0), -this.overview.target.y);
    const point = this.planePoint(pointer, plane);
    this.grab = point ? { plane, point } : undefined;
  }

  /** Middle-drag: keep the grabbed ground point under the pointer. */
  pan(pointer: Vector2): void {
    if (!this.grab) return;
    this.sync();
    const point = this.planePoint(pointer, this.grab.plane);
    if (!point) return;
    this.overview.target.add(this.grab.point.clone().sub(point).setY(0));
    this.overview.clamp();
  }

  endPan(): void {
    this.grab = undefined;
    this.followTerrain();
  }

  /** WASD and arrow keys: `forward` and `right` are −1, 0 or 1. */
  panKeys(forward: number, right: number, seconds: number): void {
    if (!forward && !right) return;
    this.stop();
    const b = MathUtils.degToRad(this.overview.bearing);
    const step = this.overview.distance * KEY_PAN_SPEED * seconds;
    const ahead = new Vector3(-Math.sin(b), 0, Math.cos(b));
    const side = new Vector3(-Math.cos(b), 0, -Math.sin(b));
    const move = ahead.multiplyScalar(forward).add(side.multiplyScalar(right));
    if (move.lengthSq() > 1) move.normalize();
    this.overview.target.addScaledVector(move, step);
    this.overview.clamp();
    this.followTerrain();
  }

  /** Mouse wheel: scale the view about the point under the pointer, which stays put. */
  zoomAt(pointer: Vector2, deltaY: number): void {
    this.stop();
    this.sync();
    this.raycaster.setFromCamera(pointer, this.camera);
    const anchor =
      this.ground.groundPoint(this.raycaster) ??
      this.planePoint(pointer, new Plane(new Vector3(0, 1, 0), -this.overview.target.y));
    const before = this.overview.distance;
    this.overview.distance = MathUtils.clamp(
      before * Math.exp(deltaY * 0.0015),
      this.overview.minDistance,
      this.overview.maxDistance,
    );
    const factor = this.overview.distance / before;
    if (anchor) this.overview.target.sub(anchor).multiplyScalar(factor).add(anchor);
    this.overview.clamp();
    this.followTerrain();
  }

  /** Keep the orbit pivot on the ground so turning feels anchored to the map. */
  followTerrain(): void {
    const target = this.overview.target;
    const height = this.ground.heightAt(target.x, target.z);
    if (height !== undefined) target.y = height;
  }

  /** Ease toward a new target and distance; instant when `duration` is 0. */
  flyTo(target: Vector3, distance: number, duration = 0.35): void {
    const to = { target: target.clone(), distance };
    if (duration <= 0) {
      this.overview.target.copy(to.target);
      this.overview.distance = to.distance;
      this.overview.clamp();
      this.tween = undefined;
      return;
    }
    this.tween = { from: this.snapshot(), to, elapsed: 0, duration };
  }

  /** Advance an ongoing flight; returns true while still moving. */
  update(seconds: number): boolean {
    const tween = this.tween;
    if (!tween) return false;
    tween.elapsed = Math.min(tween.duration, tween.elapsed + seconds);
    const t = tween.elapsed / tween.duration;
    const eased = 1 - Math.pow(1 - t, 3);
    this.overview.target.lerpVectors(tween.from.target, tween.to.target, eased);
    this.overview.distance = MathUtils.lerp(tween.from.distance, tween.to.distance, eased);
    this.overview.clamp();
    if (t >= 1) this.tween = undefined;
    return this.tween !== undefined;
  }

  get moving(): boolean {
    return this.tween !== undefined;
  }

  stop(): void {
    this.tween = undefined;
  }

  private snapshot(): Snapshot {
    return { target: this.overview.target.clone(), distance: this.overview.distance };
  }

  private sync(): void {
    this.overview.apply(this.camera);
  }

  private planePoint(pointer: Vector2, plane: Plane): Vector3 | undefined {
    this.raycaster.setFromCamera(pointer, this.camera);
    return this.raycaster.ray.intersectPlane(plane, new Vector3()) ?? undefined;
  }
}

interface Snapshot {
  target: Vector3;
  distance: number;
}
