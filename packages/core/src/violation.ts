import type { ObjectRef, ViolationKind } from '@mapedit/protocol';

/** Diagnostic identity excludes revision, source lines, messages and measured coordinates. */
export function violationId({
  kind,
  refs,
  rule = '',
}: {
  kind: ViolationKind;
  refs: readonly ObjectRef[];
  /** Stable sub-rule or field identity when one kind/ref pair can have several violations. */
  rule?: string;
}): string {
  return `${kind}:${JSON.stringify([[...new Set(refs)].sort(), rule])}`;
}
