import type { ObjectRef, Vec3, ViolationKind, ViolationView } from '@mapedit/protocol';

export interface CreateViolationInput {
  kind: ViolationKind;
  message: string;
  refs: readonly ObjectRef[];
  source?: { file: string; line: number };
  suggestion?: string;
  location?: Vec3;
  params?: Record<string, unknown>;
  /** Stable sub-rule or field identity, independent of display metadata. */
  rule?: string;
}

/** Build the wire diagnostic consistently while preserving its stable identity. */
export function createViolation(input: CreateViolationInput): ViolationView {
  const { kind, message, refs, source, suggestion, location, params = {}, rule } = input;
  return {
    id: violationId({ kind, refs, rule }),
    kind,
    message,
    refs: [...refs],
    params: { ...(source ? { file: source.file, line: source.line } : {}), ...params },
    ...(suggestion !== undefined ? { suggestion } : {}),
    ...(location ? { location } : {}),
  };
}

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
