import { parseObjectRef } from '@mapedit/protocol';
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

  constructor(readonly scene: SceneSnapshot) {
    for (const type of scene.moduleTypes) this.moduleTypes.set(type.id, type);
    for (const structure of scene.structures) {
      this.structures.set(structure.ref, structure);
      for (const instance of structure.instances) {
        this.instances.set(instance.ref, instance);
        this.owners.set(instance.ref, structure);
      }
    }
    for (const marker of scene.markers) this.markers.set(marker.ref, marker);
  }

  /** The structure a structure or module ref belongs to. */
  structureOf(ref: ObjectRef): StructureView | undefined {
    return this.structures.get(ref) ?? this.owners.get(ref);
  }

  has(ref: ObjectRef): boolean {
    return this.structures.has(ref) || this.instances.has(ref) || this.markers.has(ref);
  }

  /** Instance refs drawn for an object ref: every module of a structure, or the module itself. */
  instancesOf(ref: ObjectRef): ObjectRef[] {
    const structure = this.structures.get(ref);
    if (structure) return structure.instances.map((instance) => instance.ref);
    return this.instances.has(ref) ? [ref] : [];
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
