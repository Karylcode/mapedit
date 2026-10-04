import type { ViolationKind, ViolationView } from '@mapedit/protocol';
import type { MessageKey, Translator } from '../i18n/i18n.js';
import type { SnapshotIndex } from '../scene/snapshot-index.js';
import { objectNames } from './describe.js';

export const VIOLATION_KINDS: readonly ViolationKind[] = [
  'overlap',
  'incompatible_socket',
  'unsupported',
  'off_grid',
  'bad_rotation',
  'out_of_bounds',
  'missing_reference',
];

/** The interface-language name of a violation kind, such as 穿模 for overlap. */
export function violationKindName(kind: ViolationKind, t: Translator): string {
  return t(`violation.${kind}` as MessageKey);
}

/** A short title for one violation in the interface language. */
export function violationTitle(violation: ViolationView, t: Translator): string {
  return violationKindName(violation.kind, t);
}

export interface ViolationText {
  title: string;
  /** Names of the objects involved. */
  objects: string;
  /** What is wrong; the backend's English text until its params are translated. */
  message: string;
  suggestion?: string;
  /** `file:line` for violations that come from a file. */
  source?: string;
}

export function violationText(
  violation: ViolationView,
  index: SnapshotIndex | undefined,
  t: Translator,
): ViolationText {
  const { file, line } = violation.params as { file?: unknown; line?: unknown };
  return {
    title: violationTitle(violation, t),
    objects: objectNames(violation.refs, index, t),
    message: violation.message,
    ...(violation.suggestion ? { suggestion: violation.suggestion } : {}),
    ...(typeof file === 'string'
      ? { source: typeof line === 'number' ? `${file}:${line}` : file }
      : {}),
  };
}
