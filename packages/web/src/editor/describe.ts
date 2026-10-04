import { parseObjectRef, type ObjectRef } from '@mapedit/protocol';
import { hasMessage, type Translator } from '../i18n/i18n.js';
import { idOf, type SnapshotIndex } from '../scene/snapshot-index.js';

export interface ObjectDescription {
  /** What kind of thing it is: structure, module, spawn point… */
  kind: string;
  /** Its name: structure name, module type, or marker id. */
  name: string;
  /** Supporting detail, such as the structure a module belongs to. */
  detail?: string;
}

/** Marker types the interface knows get a translated name; others show their id. */
export function markerTypeName(type: string, t: Translator): string {
  const key = `marker.type.${type}`;
  return hasMessage(key) ? t(key) : type;
}

export function describeObject(
  ref: ObjectRef,
  index: SnapshotIndex,
  t: Translator,
): ObjectDescription | undefined {
  const marker = index.markers.get(ref);
  if (marker) return { kind: markerTypeName(marker.type, t), name: idOf(ref) };
  const structure = index.structureOf(ref);
  if (!structure) return undefined;
  if (parseObjectRef(ref)?.kind === 'module')
    return {
      kind: t('object.module'),
      name: index.label(ref),
      detail: `${index.label(structure.ref)} · ${idOf(ref)}`,
    };
  const modules = structure.instances.length;
  return {
    kind: t('object.structure'),
    name: index.label(structure.ref),
    detail: t('object.moduleCount', { count: modules }),
  };
}

/** Violations that mention an object, including through its structure or modules. */
export function violationCount(ref: ObjectRef, index: SnapshotIndex): number {
  const related = new Set([ref, ...index.instancesOf(ref)]);
  const structure = index.structureOf(ref);
  if (structure && parseObjectRef(ref)?.kind === 'module') related.add(structure.ref);
  return index.scene.violations.filter((v) => v.refs.some((r) => related.has(r))).length;
}
