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
      detail: `${index.structureName(structure.ref)} · ${idOf(ref)}`,
    };
  const name = index.structureName(structure.ref);
  const id = idOf(structure.ref);
  const modules = t('object.moduleCount', { count: structure.instances.length });
  return {
    kind: t('object.structure'),
    name,
    // The id is worth showing unless the name already includes it.
    detail: name === id || name.endsWith(`(${id})`) ? modules : `${id} · ${modules}`,
  };
}

/** One object's name in lists: modules read "Structure · instance". */
export function objectName(ref: ObjectRef, index: SnapshotIndex | undefined): string {
  // An attached structure has no view of its own: its id names it best.
  if (!index?.has(ref) || index.isAttached(ref)) return idOf(ref);
  const structure = index.structureOf(ref);
  if (!structure) return index.label(ref);
  const name = index.structureName(structure.ref);
  return parseObjectRef(ref)?.kind === 'module' ? `${name} · ${idOf(ref)}` : name;
}

/**
 * Names for a list of objects, such as "House、Watchtower 等 5 個". With
 * `byStructure`, modules count as their structure, so "the Agent changed a
 * house" does not list all of its walls.
 */
export function objectNames(
  refs: readonly ObjectRef[],
  index: SnapshotIndex | undefined,
  t: Translator,
  { limit = 3, byStructure = false }: { limit?: number; byStructure?: boolean } = {},
): string {
  const names = [
    ...new Set(
      refs.map((ref) => {
        const owner = byStructure ? index?.structureOf(ref)?.ref : undefined;
        return objectName(owner ?? ref, index);
      }),
    ),
  ];
  const separator = t('list.separator');
  if (names.length <= limit) return names.join(separator);
  return t('list.more', {
    names: names.slice(0, limit).join(separator),
    count: names.length,
    more: names.length - limit,
  });
}

/** Structures and markers among some refs, with modules replaced by their structure. */
export function wholeObjects(
  refs: readonly ObjectRef[],
  index: SnapshotIndex | undefined,
): ObjectRef[] {
  return [...new Set(refs.map((ref) => index?.structureOf(ref)?.ref ?? ref))];
}

/** Violations that mention an object, including through its structure or modules. */
export function violationCount(ref: ObjectRef, index: SnapshotIndex): number {
  const related = new Set([ref, ...index.instancesOf(ref)]);
  const structure = index.structureOf(ref);
  if (structure && parseObjectRef(ref)?.kind === 'module') related.add(structure.ref);
  return index.scene.violations.filter((v) => v.refs.some((r) => related.has(r))).length;
}
