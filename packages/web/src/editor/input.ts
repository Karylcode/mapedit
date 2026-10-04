import { Raycaster, Vector2 } from 'three';
import type { ObjectRef } from '@mapedit/protocol';
import type { MapView } from '../scene/map-view.js';
import type { OverviewControls } from '../scene/overview-controls.js';
import type { Viewport } from './viewport.js';

/** Pixels the pointer may wander before a press becomes a drag. */
const CLICK_SLOP = 5;

const PAN_KEYS: Record<string, [forward: number, right: number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
};

/** What the input layer asks the editor to do. */
export interface InputActions {
  /** A click (not a drag) on an object or on empty ground. */
  click(hit: ObjectRef | undefined): void;
  hover(hit: ObjectRef | undefined, x: number, y: number): void;
  focus(): void;
  escape(): void;
  /** A left-button drag that started on an object; return false to pan instead. */
  dragStart?(hit: ObjectRef, pointer: Vector2, client: ClientPoint): boolean;
  dragMove?(pointer: Vector2, client: ClientPoint): void;
  dragEnd?(pointer: Vector2, client: ClientPoint): void;
  /** Any other key; return true when handled. */
  key?(event: KeyboardEvent): boolean;
}

/** A page position, in CSS pixels. */
export interface ClientPoint {
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'press'; id: number; x: number; y: number; hit?: ObjectRef }
  | { kind: 'orbit'; id: number; x: number; y: number }
  | { kind: 'pan'; id: number }
  | { kind: 'drag'; id: number };

/** True when a key press belongs to a form control rather than the map. */
export function typingInto(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.isContentEditable || element.closest('input, textarea, select') !== null;
}

/** Pointer, wheel and keyboard handling for the overview mode. */
export class OverviewInput {
  private gesture?: Gesture;
  private readonly keys = new Set<string>();
  private readonly raycaster = new Raycaster();
  /** Last pointer position over the map, and whether the hover pick is stale. */
  private hoverPointer?: { x: number; y: number };
  private hoverStale = false;
  private readonly canvas: HTMLCanvasElement;

  constructor(
    private readonly viewport: Viewport,
    private readonly map: MapView,
    private readonly controls: OverviewControls,
    private readonly actions: InputActions,
  ) {
    const canvas = (this.canvas = viewport.renderer.domElement);
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this.pointerUp(event, true));
    canvas.addEventListener('pointerleave', () => {
      this.hoverPointer = undefined;
      if (!this.gesture) this.actions.hover(undefined, 0, 0);
    });
    canvas.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', (event) => this.keyDown(event));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    viewport.addTask((seconds) => this.frame(seconds));
  }

  /** Normalized device coordinates of a page position. */
  pointer(x: number, y: number): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(
      ((x - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((y - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  /** The object under a page position. */
  pick(x: number, y: number): ObjectRef | undefined {
    this.viewport.overview.apply(this.viewport.camera);
    this.raycaster.setFromCamera(this.pointer(x, y), this.viewport.camera);
    return this.map.pick(this.raycaster)?.ref;
  }

  /** Pick again on the next frame, e.g. after a snapshot moved objects under the pointer. */
  refreshHover(): void {
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  get dragging(): boolean {
    return this.gesture?.kind === 'drag';
  }

  /** Abandon the current gesture, for example when Escape cancels a drag. */
  cancelGesture(): void {
    this.gesture = undefined;
    this.controls.endPan();
  }

  private pointerDown(event: PointerEvent): void {
    if (this.gesture) return;
    // Keys go to the map after clicking it, even if the map menu had focus.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (event.button === 0)
      this.gesture = {
        kind: 'press',
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        hit: this.pick(event.clientX, event.clientY),
      };
    else if (event.button === 2)
      this.gesture = { kind: 'orbit', id: event.pointerId, x: event.clientX, y: event.clientY };
    else if (event.button === 1) {
      event.preventDefault();
      this.gesture = { kind: 'pan', id: event.pointerId };
      this.controls.beginPan(this.pointer(event.clientX, event.clientY));
    } else return;
    this.canvas.setPointerCapture(event.pointerId);
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    this.hoverPointer = { x: event.clientX, y: event.clientY };
    if (!gesture) {
      this.hoverStale = true;
      this.viewport.invalidate();
      return;
    }
    if (gesture.id !== event.pointerId) return;
    const pointer = this.pointer(event.clientX, event.clientY);
    if (gesture.kind === 'press') {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < CLICK_SLOP) return;
      const start = this.pointer(gesture.x, gesture.y);
      const client = { x: event.clientX, y: event.clientY };
      const origin = { x: gesture.x, y: gesture.y };
      if (gesture.hit && this.actions.dragStart?.(gesture.hit, start, origin)) {
        this.gesture = { kind: 'drag', id: gesture.id };
        this.actions.hover(undefined, 0, 0);
        this.actions.dragMove?.(pointer, client);
      } else {
        // A left drag on open ground moves the map, like a web map.
        this.gesture = { kind: 'pan', id: gesture.id };
        this.controls.beginPan(start);
        this.controls.pan(pointer);
      }
    } else if (gesture.kind === 'orbit') {
      this.controls.orbit(event.clientX - gesture.x, event.clientY - gesture.y);
      gesture.x = event.clientX;
      gesture.y = event.clientY;
    } else if (gesture.kind === 'pan') this.controls.pan(pointer);
    else this.actions.dragMove?.(pointer, { x: event.clientX, y: event.clientY });
    this.viewport.invalidate();
  }

  private pointerUp(event: PointerEvent, cancelled = false): void {
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    this.gesture = undefined;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (gesture.kind === 'press' && !cancelled) this.actions.click(gesture.hit);
    else if (gesture.kind === 'pan') this.controls.endPan();
    else if (gesture.kind === 'drag' && !cancelled)
      this.actions.dragEnd?.(this.pointer(event.clientX, event.clientY), {
        x: event.clientX,
        y: event.clientY,
      });
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  private wheel(event: WheelEvent): void {
    event.preventDefault();
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    this.controls.zoomAt(this.pointer(event.clientX, event.clientY), event.deltaY * lines);
    this.hoverPointer = { x: event.clientX, y: event.clientY };
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  private keyDown(event: KeyboardEvent): void {
    if (typingInto(event.target)) return;
    if (this.actions.key?.(event)) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.code in PAN_KEYS) {
      this.keys.add(event.code);
      this.viewport.invalidate();
      event.preventDefault();
    } else if (event.code === 'KeyF') {
      this.actions.focus();
      event.preventDefault();
    } else if (event.code === 'Escape') {
      this.actions.escape();
      event.preventDefault();
    }
  }

  /** Per frame: keyboard panning, camera flights and one hover pick at most. */
  private frame(seconds: number): boolean {
    let forward = 0;
    let right = 0;
    for (const code of this.keys) {
      const [f, r] = PAN_KEYS[code] ?? [0, 0];
      forward += f;
      right += r;
    }
    const panning = this.keys.size > 0;
    if (panning) this.controls.panKeys(Math.sign(forward), Math.sign(right), seconds);
    const flying = this.controls.update(seconds);
    const pointer = this.hoverPointer;
    if (pointer && !this.gesture && (this.hoverStale || panning || flying)) {
      this.hoverStale = false;
      this.actions.hover(this.pick(pointer.x, pointer.y), pointer.x, pointer.y);
    }
    return panning || flying;
  }
}
