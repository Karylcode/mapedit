import type {
  ObjectRef,
  Vec3,
  ViolationKind,
  ViolationParamsByKind,
  ViolationView,
} from '@mapedit/protocol';

/** Params a producer supplies; `file` and `line` come from `source`. */
export type ProducedParams<K extends ViolationKind> = Omit<
  ViolationParamsByKind[K],
  'file' | 'line'
>;
export type CreateViolationInput = {
  [K in ViolationKind]: {
    kind: K;
    message: string;
    refs: readonly ObjectRef[];
    source?: { file: string; line: number };
    suggestion?: string;
    location?: Vec3;
    /** Exactly the params protocol section 3 documents for this kind. */
    params: ProducedParams<K>;
    /** Stable sub-rule or field identity, independent of display metadata. */
    rule?: string;
  };
}[ViolationKind];

/** Build the wire diagnostic consistently while preserving its stable identity. */
export function createViolation(input: CreateViolationInput): ViolationView {
  const { kind, message, refs, source, suggestion, location, params, rule } = input;
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
