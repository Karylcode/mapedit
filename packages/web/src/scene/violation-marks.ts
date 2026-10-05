import type { Object3D } from 'three';
import type { ViolationView } from '@mapedit/protocol';
import { ViolationFlags } from './flags.js';
import { palette } from './palette.js';
import { BoxOutlines, GlassBoxes, type OrientedBox } from './outline.js';

/**
 * Violations on the map: a numbered flag over each, and red glass and outlines
 * around the objects they name, like an invalid placement.
 */
export class ViolationMarks {
  readonly flags = new ViolationFlags();
  readonly glass = new GlassBoxes(palette.flag, 0.3);
  readonly lines = new BoxOutlines(palette.flag, 2, { xray: false });

  /** What to add to the scene. */
  get objects(): Object3D[] {
    return [this.flags, this.glass, this.lines];
  }

  /** Mark these violations; `boxes` surround the objects they name. */
  update(violations: readonly ViolationView[], boxes: OrientedBox[], focused?: string): void {
    this.flags.update(violations, focused);
    this.glass.setBoxes(boxes);
    this.lines.setBoxes(boxes);
  }

  /** Single out one violation: only its flag changes, the boxes stay. */
  focus(violations: readonly ViolationView[], focused?: string): void {
    this.flags.update(violations, focused);
  }

  /** Line widths are in pixels, so the outlines need the drawing buffer size. */
  setResolution(width: number, height: number): void {
    this.lines.setResolution(width, height);
  }
}
