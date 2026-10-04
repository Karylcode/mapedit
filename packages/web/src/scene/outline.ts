import {
  BoxGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

/** A box given in some local frame: `matrix` maps local coordinates to map coordinates. */
export interface OrientedBox {
  matrix: Matrix4;
  min: Vector3;
  max: Vector3;
}

// prettier-ignore
const EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const;

/** Map-space line segment endpoints for the twelve edges of each box. */
export function boxEdgePositions(boxes: readonly OrientedBox[]): number[] {
  const positions: number[] = [];
  const corner = new Vector3();
  for (const box of boxes) {
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      corner
        .set(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        )
        .applyMatrix4(box.matrix)
        .toArray(),
    );
    for (const [a, b] of EDGES) positions.push(...corners[a]!, ...corners[b]!);
  }
  return positions;
}

/** Screen-space-width box outlines (the "chalk line"). */
export class BoxOutlines extends LineSegments2 {
  constructor(
    color: number,
    width: number,
    { opacity = 1, xray = true }: { opacity?: number; xray?: boolean } = {},
  ) {
    const material = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity,
      depthTest: !xray,
      depthWrite: false,
    });
    super(new LineSegmentsGeometry(), material);
    this.renderOrder = xray ? 12 : 3;
    this.frustumCulled = false;
    this.visible = false;
  }

  setBoxes(boxes: readonly OrientedBox[]): void {
    const geometry = new LineSegmentsGeometry();
    if (boxes.length) geometry.setPositions(boxEdgePositions(boxes));
    this.geometry.dispose();
    this.geometry = geometry;
    this.visible = boxes.length > 0;
  }

  setResolution(width: number, height: number): void {
    this.material.resolution.set(width, height);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Translucent boxes, like the red "can't build here" volume in building games. */
export class GlassBoxes extends InstancedMesh {
  private static unit = new BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);

  constructor(color: number, opacity: number, capacity = 16) {
    super(
      GlassBoxes.unit,
      new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity,
        depthWrite: false,
      }),
      capacity,
    );
    this.renderOrder = 4;
    this.frustumCulled = false;
    this.count = 0;
  }

  /** Each box grows by `pad` meters on every side so it wraps the object it marks. */
  setBoxes(boxes: readonly OrientedBox[], pad = 0.04): void {
    if (boxes.length > this.instanceMatrix.count)
      this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(boxes.length * 32), 16);
    const local = new Matrix4();
    const size = new Vector3();
    boxes.forEach((box, i) => {
      size.subVectors(box.max, box.min).addScalar(pad * 2);
      local
        .makeScale(size.x, size.y, size.z)
        .setPosition(box.min.x - pad, box.min.y - pad, box.min.z - pad);
      this.setMatrixAt(i, local.premultiply(box.matrix));
    });
    this.count = boxes.length;
    this.instanceMatrix.needsUpdate = true;
  }
}
