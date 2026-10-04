import type { ModelGeometry } from '@mapedit/core';
import type { Vec3 } from '@mapedit/protocol';

/** Private stdin/stdout boundary between the trusted runner and disposable worker. */
export interface ModelWorkerRequest {
  code: string;
  size: Vec3;
  material: string;
  timeoutMs: number;
}

export type ModelWorkerResponse =
  { ok: true; geometry: ModelGeometry } | { ok: false; error: string };
