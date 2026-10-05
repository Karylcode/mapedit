import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { InstanceView, ObjectRef } from '@mapedit/protocol';
import type { Asset } from './assets.js';
import type { SnapshotIndex } from './snapshot-index.js';
import { palette } from './palette.js';

interface ModuleBatch {
  /** The asset the meshes were built from; undefined for placeholder boxes. */
  asset?: Asset;
  meshes: InstancedMesh[];
  capacity: number;
  refs: ObjectRef[];
}

/** A module type's model: loaded, still on its way, or failed to load. */
export type ModelState = Asset | 'loading' | 'failed';

const WHITE = new Color(1, 1, 1);
const VIOLATION_TINT = new Color(1, 0.5, 0.45);
const scratch = new Matrix4();

/**
 * The structures' modules, one instanced batch per module type. A type whose
 * model is missing or failed to load is drawn as see-through red boxes.
 */
export class ModuleBatches {
  readonly group = new Group();
  private readonly batches = new Map<string, ModuleBatch>();

  /** `look` gives the material a model part is drawn with, such as its cel-shaded twin. */
  constructor(private readonly look: (material: Material) => Material = (material) => material) {
    this.group.name = 'modules';
  }

  /**
   * Draw a snapshot's modules, tinting those in violation. `model` gives a
   * type's model and starts loading it when needed; while it loads, the type
   * keeps what it showed before.
   */
  update(
    index: SnapshotIndex,
    violating: ReadonlySet<ObjectRef>,
    model: (url: string) => ModelState,
  ): void {
    const byType = new Map<string, InstanceView[]>();
    for (const structure of index.scene.structures)
      for (const instance of structure.instances) {
        const list = byType.get(instance.moduleType) ?? [];
        list.push(instance);
        byType.set(instance.moduleType, list);
      }
    for (const [typeId, batch] of this.batches)
      if (!byType.has(typeId)) {
        this.remove(batch);
        this.batches.delete(typeId);
      }
    for (const [typeId, instances] of byType) {
      const type = index.moduleTypes.get(typeId);
      const state: ModelState = type ? model(type.url) : 'failed';
      let asset: Asset | undefined;
      if (state === 'loading') {
        // Keep drawing what this type showed until the model arrives: its previous
        // model, or the box of one that failed and is being asked for again.
        const previous = this.batches.get(typeId);
        if (!previous) continue;
        asset = previous.asset;
      } else if (state !== 'failed') asset = state;
      const batch = this.batchFor(typeId, asset, instances.length, type?.size);
      batch.refs = instances.map((instance) => instance.ref);
      instances.forEach((instance, i) => {
        const transform = scratch.fromArray(instance.transform);
        const tint = violating.has(instance.ref) ? VIOLATION_TINT : WHITE;
        batch.meshes.forEach((mesh, part) => {
          const local = asset?.parts[part]?.matrix;
          mesh.setMatrixAt(i, local ? transform.clone().multiply(local) : transform);
          mesh.setColorAt(i, tint);
        });
      });
      for (const mesh of batch.meshes) {
        mesh.count = instances.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }
  }

  /** The module an instanced mesh was hit at, if the mesh is one of these batches. */
  refAt(object: Object3D, instanceId: number | undefined): ObjectRef | undefined {
    const batch = object.userData.batch as ModuleBatch | undefined;
    return batch && instanceId !== undefined ? batch.refs[instanceId] : undefined;
  }

  /** URLs of the models drawn now. */
  urls(): string[] {
    return [...this.batches.values()].flatMap((batch) => (batch.asset ? [batch.asset.url] : []));
  }

  clear(): void {
    for (const batch of this.batches.values()) this.remove(batch);
    this.batches.clear();
  }

  private batchFor(
    typeId: string,
    asset: Asset | undefined,
    count: number,
    size: readonly number[] | undefined,
  ): ModuleBatch {
    const existing = this.batches.get(typeId);
    if (existing && existing.asset === asset && existing.capacity >= count) return existing;
    if (existing) this.remove(existing);
    // A new model for the same instances keeps the buffer; only more instances grow it.
    const capacity =
      existing && count <= existing.capacity
        ? existing.capacity
        : Math.max(count, existing ? existing.capacity * 2 : 0, 1);
    const batch: ModuleBatch = { asset, meshes: [], capacity, refs: [] };
    const parts = asset
      ? asset.parts.map((part) => ({ geometry: part.geometry, material: this.look(part.material) }))
      : [placeholderPart(size)];
    for (const part of parts) {
      const mesh = new InstancedMesh(part.geometry, part.material, capacity);
      mesh.name = typeId;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.batch = batch;
      mesh.userData.placeholder = !asset;
      batch.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.batches.set(typeId, batch);
    return batch;
  }

  private remove(batch: ModuleBatch): void {
    for (const mesh of batch.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
      if (mesh.userData.placeholder) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
      }
    }
  }
}

/** A see-through red box for modules whose type is missing or failed to load. */
function placeholderPart(size: readonly number[] | undefined) {
  const [x, y, z] = size && size.length === 3 ? size : [1, 1, 1];
  const geometry = new BoxGeometry(x, y, z).translate(x! / 2, y! / 2, z! / 2);
  const material = new MeshStandardMaterial({
    color: palette.missing,
    transparent: true,
    opacity: 0.55,
    roughness: 0.9,
  });
  return { geometry, material };
}
