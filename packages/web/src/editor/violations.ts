import type { ViolationKind, ViolationView } from '@mapedit/protocol';
import type { MessageKey, Translator } from '../i18n/i18n.js';

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
