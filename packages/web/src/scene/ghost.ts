import {
  BoxGeometry,
  Color,
  GridHelper,
  Group,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
} from 'three';
import type { ObjectRef } from '@mapedit/protocol';
import type { MapView } from './map-view.js';
import { BoxOutlines } from './outline.js';
import { palette } from './palette.js';

export type GhostState = 'pending' | 'ok' | 'blocked';

const COLORS: Record<GhostState, number> = {
  pending: palette.chalkline,
  ok: palette.chalkline,
  blocked: palette.flag,
};

/**
 * The see-through copy shown while dragging, like a building game's placement
 * preview. It is built in the object's own frame (the structure transform, or
 * a marker's position and rotation) and moved by setting that frame.
 */
export class Ghost extends Group {
  private readonly material = new MeshLambertMaterial({
    color: palette.chalkline,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  private readonly outlines = new BoxOutlines(palette.chalkline, 2);
  private readonly body = new Group();
  private readonly grid = new GridHelper(16, 32, palette.previewGrid, palette.previewGrid);
  private readonly owned: (BufferGeometry | Material)[] = [];
  state: GhostState = 'pending';

  constructor(
    map: MapView,
    readonly ref: ObjectRef,
    /** The object's frame when the drag started. */
    readonly frame: Matrix4,
  ) {
    super();
    this.name = 'ghost';
    this.matrixAutoUpdate = false;
    this.body.matrixAutoUpdate = false;
    const toLocal = frame.clone().invert();
    const index = map.index;
    const structure = index?.structures.get(ref);
    if (structure)
      for (const instance of structure.instances) {
        const local = new Matrix4().fromArray(instance.transform).premultiply(toLocal);
        const asset = map.moduleAsset(instance.moduleType);
        const parts = asset
          ? asset.parts.map((part) => ({ geometry: part.geometry, matrix: part.matrix }))
          : [{ geometry: this.box(map.moduleSize(instance.moduleType)), matrix: new Matrix4() }];
        for (const part of parts) {
          const mesh = new Mesh(part.geometry, this.material);
          mesh.matrixAutoUpdate = false;
          mesh.matrix.multiplyMatrices(local, part.matrix);
          mesh.renderOrder = 6;
          this.body.add(mesh);
        }
      }
    const boxes = map.boxesFor(ref).map((box) => ({
      ...box,
      matrix: box.matrix.clone().premultiply(toLocal),
    }));
    if (!structure)
      for (const box of boxes) {
        const size = box.max.clone().sub(box.min);
        const mesh = new Mesh(this.box([size.x, size.y, size.z]), this.material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(box.matrix).multiply(new Matrix4().makeTranslation(box.min));
        this.body.add(mesh);
      }
    this.outlines.setBoxes(boxes);
    this.outlines.matrixAutoUpdate = false;
    this.body.add(this.outlines);
    const gridMaterial = this.grid.material as Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    gridMaterial.depthWrite = false;
    this.grid.matrixAutoUpdate = false;
    this.add(this.body, this.grid);
    this.place(frame);
  }

  /** Move the preview to a new object frame (map coordinates). */
  place(frame: Matrix4): void {
    this.body.matrix.copy(frame);
    this.body.matrixWorldNeedsUpdate = true;
    // The snap grid stays aligned with the map grid, centered under the object.
    const x = Math.round(frame.elements[12]! * 2) / 2;
    const z = Math.round(frame.elements[14]! * 2) / 2;
    this.grid.matrix.makeTranslation(x, frame.elements[13]! + 0.02, z);
    this.grid.matrixWorldNeedsUpdate = true;
  }

  setState(state: GhostState): void {
    this.state = state;
    const color = new Color(COLORS[state]);
    this.material.color.copy(color);
    this.material.opacity = state === 'pending' ? 0.35 : 0.5;
    this.outlines.material.color.copy(color);
    this.grid.visible = state !== 'blocked';
  }

  setResolution(width: number, height: number): void {
    this.outlines.setResolution(width, height);
  }

  dispose(): void {
    this.material.dispose();
    this.outlines.dispose();
    this.grid.dispose();
    for (const item of this.owned) item.dispose();
  }

  private box(size: readonly number[]): BufferGeometry {
    const [x = 1, y = 1, z = 1] = size;
    const geometry = new BoxGeometry(x, y, z).translate(x / 2, y / 2, z / 2);
    this.owned.push(geometry);
    return geometry;
  }
}
