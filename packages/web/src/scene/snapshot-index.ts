import { parseObjectRef, structureRef } from '@mapedit/protocol';
import type {
  InstanceView,
  MarkerView,
  ModuleTypeView,
  ObjectRef,
  SceneSnapshot,
  StructureView,
  ViolationView,
} from '@mapedit/protocol';

/** Lookups over one snapshot. Merged structures list attached modules under the root. */
export class SnapshotIndex {
  readonly structures = new Map<ObjectRef, StructureView>();
  readonly instances = new Map<ObjectRef, InstanceView>();
  readonly markers = new Map<ObjectRef, MarkerView>();
  readonly moduleTypes = new Map<string, ModuleTypeView>();
  /** Instance ref → the structure that draws it. */
  private readonly owners = new Map<ObjectRef, StructureView>();
  /**
   * `structure:<id>` → instances whose refs are `module:<id>/…`. A structure
   * attached to another is drawn inside the root's view but keeps these refs.
   */
  private readonly bySource = new Map<ObjectRef, InstanceView[]>();
  /** How many structures share each name. */
  private readonly nameCounts = new Map<string, number>();

  constructor(readonly scene: SceneSnapshot) {
    for (const type of scene.moduleTypes) this.moduleTypes.set(type.id, type);
    for (const structure of scene.structures) {
      this.structures.set(structure.ref, structure);
      const name = structure.name ?? idOf(structure.ref);
      this.nameCounts.set(name, (this.nameCounts.get(name) ?? 0) + 1);
      for (const instance of structure.instances) {
        this.instances.set(instance.ref, instance);
        this.owners.set(instance.ref, structure);
        const parsed = parseObjectRef(instance.ref);
        if (parsed?.kind !== 'module') continue;
        const source = structureRef(parsed.structureId);
        const list = this.bySource.get(source) ?? [];
        list.push(instance);
        this.bySource.set(source, list);
      }
    }
    for (const marker of scene.markers) this.markers.set(marker.ref, marker);
  }

  /**
   * A structure's name that tells it apart: its name, followed by its id
   * when other structures share the name (several "Starter House"s).
   */
  structureName(ref: ObjectRef): string {
    const name = this.label(ref);
    const id = idOf(ref);
    return (this.nameCounts.get(name) ?? 0) > 1 && name !== id ? `${name} (${id})` : name;
  }

  /** The drawn structure a structure or module ref belongs to (the root, for an attached one). */
  structureOf(ref: ObjectRef): StructureView | undefined {
    const attached = this.bySource.get(ref)?.[0];
    return (
      this.structures.get(ref) ??
      this.owners.get(ref) ??
      (attached && this.owners.get(attached.ref))
    );
  }

  has(ref: ObjectRef): boolean {
    return (
      this.structures.has(ref) ||
      this.instances.has(ref) ||
      this.markers.has(ref) ||
      this.bySource.has(ref)
    );
  }

  /** True for a structure drawn inside another one because it is attached to it. */
  isAttached(ref: ObjectRef): boolean {
    return !this.structures.has(ref) && this.bySource.has(ref);
  }

  /**
   * Instances drawn for an object ref: every module of a drawn structure, the
   * modules of an attached structure, or the module itself.
   */
  instancesOf(ref: ObjectRef): ObjectRef[] {
    const structure = this.structures.get(ref);
    if (structure) return structure.instances.map((instance) => instance.ref);
    if (this.instances.has(ref)) return [ref];
    return (this.bySource.get(ref) ?? []).map((instance) => instance.ref);
  }

  /** Display name: structure name, module type name, or marker type, falling back to ids. */
  label(ref: ObjectRef): string {
    const structure = this.structures.get(ref);
    if (structure) return structure.name ?? idOf(ref);
    const instance = this.instances.get(ref);
    if (instance) return this.moduleTypes.get(instance.moduleType)?.name ?? instance.moduleType;
    return idOf(ref);
  }
}

/** The id part of a ref (`house` for `structure:house`, `wall_n` for a module). */
export function idOf(ref: ObjectRef): string {
  const parsed = parseObjectRef(ref);
  if (!parsed) return ref;
  if (parsed.kind === 'structure') return parsed.structureId;
  if (parsed.kind === 'module') return parsed.instanceId;
  return parsed.markerId;
}

/** Refs of drawn instances and markers that any violation refers to. */
/**
 * An overlap the backend estimated from bounding boxes after its exact limit;
 * it may not be real until the overlaps before it are fixed (protocol section 3).
 */
export function isEstimated(violation: ViolationView): boolean {
  return (
    violation.kind === 'overlap' && (violation.params as { estimated?: unknown }).estimated === true
  );
}

export function violatingRefs(
  index: SnapshotIndex,
  violations: readonly ViolationView[],
): Set<ObjectRef> {
  const refs = new Set<ObjectRef>();
  for (const violation of violations)
    for (const ref of violation.refs) {
      for (const instance of index.instancesOf(ref)) refs.add(instance);
      if (index.markers.has(ref)) refs.add(ref);
      // A module ref whose structure failed to compile still marks itself.
      if (parseObjectRef(ref)?.kind === 'module') refs.add(ref);
    }
  return refs;
}
