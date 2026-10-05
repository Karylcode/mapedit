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

/** First-person flight keys, by key position: forward, right and up. */
const FLY_KEYS: Record<string, [forward: number, right: number, up: number]> = {
  KeyW: [1, 0, 0],
  ArrowUp: [1, 0, 0],
  KeyS: [-1, 0, 0],
  ArrowDown: [-1, 0, 0],
  KeyA: [0, -1, 0],
  ArrowLeft: [0, -1, 0],
  KeyD: [0, 1, 0],
  ArrowRight: [0, 1, 0],
  Space: [0, 0, 1],
  ShiftLeft: [0, 0, -1],
  ShiftRight: [0, 0, -1],
};

/** What the input layer asks the editor to do. */
export interface InputActions {
  /** A click (not a drag) on an object or on empty ground. */
  click(hit: ObjectRef | undefined): void;
  hover(hit: ObjectRef | undefined, x: number, y: number): void;
  /**
   * A left-button drag that started on an object: `drag` moves it, `pan`
   * moves the map instead, `blocked` does neither until the button is released.
   */
  dragStart?(hit: ObjectRef, pointer: Vector2, client: ClientPoint): 'drag' | 'pan' | 'blocked';
  dragMove?(pointer: Vector2, client: ClientPoint): void;
  dragEnd?(pointer: Vector2, client: ClientPoint): void;
  /** The browser took the pointer away before the drop, e.g. on a window switch. */
  dragCancel?(): void;
  /** A key press that is not camera movement; return true when handled. */
  key(event: KeyboardEvent): boolean;
  /** First-person mode started or ended. */
  modeChanged?(firstPerson: boolean): void;
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
  | { kind: 'drag'; id: number }
  | { kind: 'held'; id: number };

/** True when a key press belongs to a form control rather than the map. */
export function typingInto(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.isContentEditable || element.closest('input, textarea, select') !== null;
}

/**
 * Pointer, wheel and keyboard handling for the overview mode, and for
 * first-person mode, where the mouse turns the view and the keys fly.
 */
export class OverviewInput {
  private gesture?: Gesture;
  /** Whether the canvas holds the pointer lock of first-person mode. */
  private locked = false;
  /** First-person mode without the pointer lock: a held button drags the view around. */
  private look?: { id: number; x: number; y: number };
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
    // The browser can end a gesture without a pointerup: touch and pen cancels,
    // a lost capture, or the window losing focus mid-drag.
    canvas.addEventListener('pointercancel', (event) => this.interrupt(event.pointerId));
    canvas.addEventListener('lostpointercapture', (event) => this.interrupt(event.pointerId));
    canvas.addEventListener('pointerleave', () => {
      this.hoverPointer = undefined;
      if (!this.gesture) this.actions.hover(undefined, 0, 0);
    });
    canvas.addEventListener('wheel', (event) => this.wheel(event), { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', (event) => this.keyDown(event));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.gesture) this.interrupt(this.gesture.id);
    });
    document.addEventListener('pointerlockchange', () => this.lockChanged());
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

  get firstPerson(): boolean {
    return this.viewport.mode === 'firstPerson';
  }

  /** Fly from where the overview camera is, facing the same way, and capture the mouse. */
  enterFirstPerson(): void {
    if (this.firstPerson) return;
    if (this.gesture) this.interrupt(this.gesture.id);
    this.controls.stop();
    this.keys.clear();
    const { firstPerson, overview } = this.viewport;
    const scene = this.map.scene;
    if (scene) firstPerson.setMap(scene.map.size);
    firstPerson.fromOverview(overview);
    this.viewport.mode = 'firstPerson';
    this.hoverPointer = undefined;
    this.actions.hover(undefined, 0, 0);
    this.actions.modeChanged?.(true);
    this.capture();
    this.viewport.invalidate();
  }

  /** Back to the overview, above where the eye was and facing the same way. */
  leaveFirstPerson(): void {
    if (!this.firstPerson) return;
    this.look = undefined;
    this.keys.clear();
    this.viewport.firstPerson.toOverview(this.viewport.overview);
    this.controls.followTerrain();
    this.viewport.mode = 'overview';
    this.locked = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.actions.modeChanged?.(false);
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  /** Hide the cursor so the mouse turns the view; without it, dragging does. */
  private capture(): void {
    try {
      // Newer browsers return a promise that rejects when the lock is refused.
      const request = this.canvas.requestPointerLock() as unknown;
      if (request instanceof Promise) request.catch(() => undefined);
    } catch {
      // No pointer lock here: dragging turns the view instead.
    }
  }

  private lockChanged(): void {
    const locked = document.pointerLockElement === this.canvas;
    const lost = this.locked && !locked;
    this.locked = locked;
    // Escape releases the mouse before the page sees the key: that ends first-person mode.
    if (lost) this.leaveFirstPerson();
  }

  /** Abandon the current gesture, for example when Escape cancels a drag. */
  cancelGesture(): void {
    this.gesture = undefined;
    this.controls.endPan();
  }

  /** The gesture ended without a drop: a drag in progress is called off, nothing is applied. */
  private interrupt(pointerId: number): void {
    if (this.look?.id === pointerId) this.look = undefined;
    const gesture = this.gesture;
    if (!gesture || gesture.id !== pointerId) return;
    this.cancelGesture();
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    if (gesture.kind === 'drag') this.actions.dragCancel?.();
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  private pointerDown(event: PointerEvent): void {
    if (this.gesture) return;
    // Keys go to the map after clicking it, even if the map menu had focus.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (this.firstPerson) {
      // First-person mode only looks around: a click captures the mouse again.
      if (this.locked || this.look) return;
      this.capture();
      this.look = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer lock just took the pointer; it turns the view from here.
      }
      return;
    }
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
    if (this.firstPerson) {
      const look = this.look;
      if (this.locked) this.viewport.firstPerson.look(event.movementX, event.movementY);
      else if (look?.id === event.pointerId) {
        this.viewport.firstPerson.look(event.clientX - look.x, event.clientY - look.y);
        look.x = event.clientX;
        look.y = event.clientY;
      } else return;
      this.viewport.invalidate();
      return;
    }
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
      const outcome = gesture.hit ? this.actions.dragStart?.(gesture.hit, start, origin) : 'pan';
      if (outcome === 'drag') {
        this.gesture = { kind: 'drag', id: gesture.id };
        this.actions.hover(undefined, 0, 0);
        this.actions.dragMove?.(pointer, client);
      } else if (outcome === 'blocked') {
        // The editor explained why; the map stays put until the button is released.
        this.gesture = { kind: 'held', id: gesture.id };
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
    else if (gesture.kind === 'drag')
      this.actions.dragMove?.(pointer, { x: event.clientX, y: event.clientY });
    this.viewport.invalidate();
  }

  private pointerUp(event: PointerEvent): void {
    if (this.look?.id === event.pointerId) {
      this.look = undefined;
      if (this.canvas.hasPointerCapture(event.pointerId))
        this.canvas.releasePointerCapture(event.pointerId);
      return;
    }
    const gesture = this.gesture;
    if (!gesture || gesture.id !== event.pointerId) return;
    this.gesture = undefined;
    if (this.canvas.hasPointerCapture(event.pointerId))
      this.canvas.releasePointerCapture(event.pointerId);
    if (gesture.kind === 'press') this.actions.click(gesture.hit);
    else if (gesture.kind === 'pan') this.controls.endPan();
    else if (gesture.kind === 'drag')
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
    if (this.firstPerson) {
      this.viewport.firstPerson.changeSpeed(event.deltaY * lines);
      return;
    }
    this.controls.zoomAt(this.pointer(event.clientX, event.clientY), event.deltaY * lines);
    this.hoverPointer = { x: event.clientX, y: event.clientY };
    this.hoverStale = true;
    this.viewport.invalidate();
  }

  private keyDown(event: KeyboardEvent): void {
    if (typingInto(event.target)) return;
    if (this.actions.key(event)) {
      event.preventDefault();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // WASD and arrows are directions, so they follow key positions on any layout.
    if (event.code in (this.firstPerson ? FLY_KEYS : PAN_KEYS)) {
      this.keys.add(event.code);
      this.viewport.invalidate();
      event.preventDefault();
    }
  }

  /** Per frame: keyboard panning, camera flights and one hover pick at most. */
  private frame(seconds: number): boolean {
    if (this.firstPerson) return this.fly(seconds);
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

  /** Per frame in first-person mode: fly while movement keys are held. */
  private fly(seconds: number): boolean {
    let forward = 0;
    let right = 0;
    let up = 0;
    for (const code of this.keys) {
      const [f, r, u] = FLY_KEYS[code] ?? [0, 0, 0];
      forward += f;
      right += r;
      up += u;
    }
    if (forward || right || up)
      this.viewport.firstPerson.move(
        Math.sign(forward),
        Math.sign(right),
        Math.sign(up),
        seconds,
        (x, z) => this.map.heightAt(x, z),
      );
    return this.keys.size > 0;
  }
}
