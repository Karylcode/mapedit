import { Vector3, type Camera, type Object3D } from 'three';

interface ScreenSize {
  width: number;
  height: number;
  /** Full size up to this camera distance, then shrinking with distance. */
  near: number;
  /** The smallest fraction of the full size. */
  min: number;
}

/**
 * Sprites drawn without size attenuation keep a constant on-screen size; their
 * scale is in clip-space units, so it depends on the viewport and projection.
 * Far away they shrink a little, so a map full of flags stays readable.
 */
export function setScreenSize(
  sprite: Object3D,
  width: number,
  height: number,
  { near = 120, min = 0.45 }: { near?: number; min?: number } = {},
): void {
  sprite.userData.screenSize = { width, height, near, min } satisfies ScreenSize;
}

const position = new Vector3();
const eye = new Vector3();

export function fitScreenSprites(
  sprites: Iterable<Object3D>,
  viewportHeight: number,
  camera: Camera,
): void {
  const projectionY = camera.projectionMatrix.elements[5]!;
  const unit = 2 / (Math.max(1, viewportHeight) * projectionY);
  const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
  camera.getWorldPosition(eye);
  for (const sprite of sprites) {
    const size = sprite.userData.screenSize as ScreenSize | undefined;
    if (!size) continue;
    let factor = 1;
    if (perspective) {
      const distance = sprite.getWorldPosition(position).distanceTo(eye);
      factor = Math.max(size.min, Math.min(1, size.near / Math.max(distance, 1)));
    }
    sprite.scale.set(size.width * unit * factor, size.height * unit * factor, 1);
  }
}
