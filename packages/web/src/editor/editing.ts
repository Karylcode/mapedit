import { Matrix4, Raycaster, Vector3, type Vector2 } from 'three';
import type { Edit, ObjectRef, ServerMessage, Vec3, ViolationView } from '@mapedit/protocol';
import type { Connection, Request } from '../net/connection.js';
import { translate, type MessageKey, type Params } from '../i18n/i18n.js';
import type { MapView } from '../scene/map-view.js';
import { Ghost } from '../scene/ghost.js';
import type { Store } from './store.js';
import type { EditorState } from './state.js';
import type { Viewport } from './viewport.js';
import type { Toasts } from './hud/toasts.js';
import type { CursorNote } from './hud/cursor-note.js';
import { PreviewThrottle } from './preview-throttle.js';
import { movableOf } from './selection.js';
import { objectName } from './describe.js';
import { normalizeAngle, turnAbout, turnXZ, yawOf } from './move-math.js';
import { violationMessage, violationTitle } from './violations.js';

/** Degrees per press of R, matching the structure rotation step. */
export const ROTATION_STEP = 15;

interface Point {
  x: number;
  y: number;
}

interface Drag {
  ref: ObjectRef;
  baseRevision: number;
  /** Object origin minus the ground point first grabbed, on x and z. */
  offset: [number, number];
  rotation: number;
  pointer: Vector2;
  client: Point;
  ghost: Ghost;
  /** Set once dropped: the applyEdit request, then whether it succeeded. */
  applyId?: number;
  applied?: boolean;
}

type Pending =
  | { kind: 'apply'; ref: ObjectRef; action: 'move' | 'rotate' | 'delete' }
  | { kind: 'undo' | 'redo' };

/** An edit the backend has not answered, or answered before its snapshot arrived. */
interface InFlight {
  requestId: number;
  edit: Edit;
  answered: boolean;
}

/** What a left-button drag on an object turns into. */
export type DragStart = 'drag' | 'pan' | 'blocked';

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The human's edits: dragging with a live preview, rotating, deleting, undo
 * and redo. The backend decides snapping and legality; this only asks.
 */
export class EditController {
  private drag?: Drag;
  private readonly throttle: PreviewThrottle;
  private readonly raycaster = new Raycaster();
  private readonly pending = new Map<number, Pending>();
  /**
   * Edits per object until the snapshot showing them arrives, so quick
   * repeated presses build on what was already sent instead of the old snapshot.
   */
  private readonly inFlight = new Map<ObjectRef, InFlight>();

  constructor(
    private readonly connection: Connection,
    private readonly store: Store<EditorState>,
    private readonly map: MapView,
    private readonly viewport: Viewport,
    private readonly toasts: Toasts,
    private readonly note: CursorNote,
  ) {
    this.throttle = new PreviewThrottle((edit) =>
      connection.request({ type: 'previewEdit', edit }),
    );
    connection.on('message', (message) => this.receive(message));
    connection.on('status', (status) => {
      if (status !== 'open') this.disconnected();
    });
    viewport.addTask(() => this.frame());
  }

  get dragging(): boolean {
    return this.drag !== undefined && this.drag.applyId === undefined;
  }

  /**
   * The revision edits are based on, or undefined while the open map's first
   * snapshot has not arrived: what is drawn then belongs to another map, and
   * an edit naming its ids would land on the newly opened one.
   */
  private baseRevision(): number | undefined {
    const { scene, mapId, revision } = this.store.state;
    return scene && scene.map.id === mapId && this.map.scene?.map.id === mapId
      ? revision
      : undefined;
  }

  /**
   * Start dragging the structure or marker under the pointer. Over open
   * ground, or before the map is drawn, the drag pans instead; while the
   * object still has a change on its way, it is held with a hint to wait.
   */
  beginDrag(hit: ObjectRef, pointer: Vector2, client: Point): DragStart {
    const baseRevision = this.baseRevision();
    const index = this.map.index;
    const ref = index && movableOf(hit, index);
    const frame = ref && this.map.frameOf(ref);
    if (baseRevision === undefined || !index || !ref || !frame) return 'pan';
    if (this.drag || this.inFlight.has(ref)) {
      this.say('info', 'edit.busy');
      return 'blocked';
    }
    if (this.connection.status !== 'open') {
      this.say('warning', 'edit.offline');
      return 'blocked';
    }
    const grab = this.ground(pointer);
    if (!grab) return 'pan';
    const origin = new Vector3().setFromMatrixPosition(frame);
    const ghost = new Ghost(this.map, ref, frame);
    const ratio = this.viewport.renderer.getPixelRatio();
    ghost.setResolution(this.viewport.size.x * ratio, this.viewport.size.y * ratio);
    this.viewport.scene.add(ghost);
    this.drag = {
      ref,
      baseRevision,
      offset: [origin.x - grab.x, origin.z - grab.z],
      rotation: this.rotationOf(ref),
      pointer: pointer.clone(),
      client,
      ghost,
    };
    this.store.set({ selection: ref, hover: undefined });
    this.viewport.invalidate();
    return 'drag';
  }

  dragMove(pointer: Vector2, client: Point): void {
    if (!this.dragging) return;
    this.drag!.pointer.copy(pointer);
    this.drag!.client = client;
    this.note.move(client.x, client.y);
    this.viewport.invalidate();
  }

  /** Drop: ask the backend to apply the move; the preview stays until it answers. */
  dragEnd(pointer: Vector2, client: Point): void {
    const drag = this.drag;
    if (!drag || drag.applyId !== undefined) return;
    drag.pointer.copy(pointer);
    drag.client = client;
    const edit = this.moveEdit(drag);
    this.note.hide();
    this.throttle.reset();
    if (!edit) return this.cancelDrag();
    const id = this.send(
      { type: 'applyEdit', edit, baseRevision: drag.baseRevision },
      { kind: 'apply', ref: drag.ref, action: 'move' },
    );
    if (id === undefined) return this.cancelDrag();
    drag.applyId = id;
    drag.ghost.setState('pending');
    this.viewport.invalidate();
  }

  cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = undefined;
    this.viewport.scene.remove(drag.ghost);
    drag.ghost.dispose();
    this.note.hide();
    this.throttle.reset();
    this.viewport.invalidate();
  }

  /** R turns the dragged preview, or the selected structure or marker about its center. */
  rotate(direction: 1 | -1): void {
    const step = ROTATION_STEP * direction;
    const drag = this.drag;
    if (drag) {
      if (drag.applyId !== undefined) return;
      drag.rotation = normalizeAngle(drag.rotation + step);
      drag.offset = turnXZ(drag.offset[0], drag.offset[1], step);
      this.viewport.invalidate();
      return;
    }
    const baseRevision = this.baseRevision();
    const index = this.map.index;
    const selection = this.store.state.selection;
    const ref = index && selection ? movableOf(selection, index) : undefined;
    const frame = ref && this.map.frameOf(ref);
    const bounds = ref && this.map.boundsOf(ref);
    if (baseRevision === undefined || !ref || !frame || !bounds) return;
    // Turning about the center keeps the center fixed, so presses made before
    // the next snapshot continue from the last position and angle sent.
    const previous = this.inFlight.get(ref)?.edit;
    if (previous?.kind === 'delete') return;
    const origin =
      previous?.position ?? (new Vector3().setFromMatrixPosition(frame).toArray() as Vec3);
    const rotation = previous?.rotation ?? this.rotationOf(ref);
    const center = bounds.getCenter(new Vector3()).toArray() as Vec3;
    const position = turnAbout(origin, center, step).map(round) as Vec3;
    this.send(
      {
        type: 'applyEdit',
        edit: { kind: 'move', ref, position, rotation: normalizeAngle(rotation + step) },
        baseRevision,
      },
      { kind: 'apply', ref, action: 'rotate' },
    );
  }

  /** Delete removes the selected structure, single module or marker. */
  deleteSelection(): void {
    const baseRevision = this.baseRevision();
    const ref = this.store.state.selection;
    if (baseRevision === undefined || !ref || this.drag) return;
    if (this.inFlight.get(ref)?.edit.kind === 'delete') return;
    this.send(
      {
        type: 'applyEdit',
        edit: { kind: 'delete', ref },
        baseRevision,
      },
      { kind: 'apply', ref, action: 'delete' },
    );
  }

  undo(): void {
    if (!this.drag) this.send({ type: 'undo' }, { kind: 'undo' });
  }

  redo(): void {
    if (!this.drag) this.send({ type: 'redo' }, { kind: 'redo' });
  }

  private send(request: Request, pending: Pending): number | undefined {
    const id = this.connection.request(request);
    if (id === undefined) {
      this.say('warning', 'edit.offline');
      return undefined;
    }
    this.pending.set(id, pending);
    if (request.type === 'applyEdit')
      this.inFlight.set(request.edit.ref, { requestId: id, edit: request.edit, answered: false });
    return id;
  }

  /** Once per frame while dragging: ask for a preview of where the pointer is. */
  private frame(): boolean {
    const drag = this.drag;
    if (!drag || drag.applyId !== undefined) return false;
    const edit = this.moveEdit(drag);
    if (edit) this.throttle.want(edit);
    return false;
  }

  private moveEdit(drag: Drag): Extract<Edit, { kind: 'move' }> | undefined {
    const ground = this.ground(drag.pointer);
    if (!ground) return undefined;
    return {
      kind: 'move',
      ref: drag.ref,
      position: [
        round(ground.x + drag.offset[0]),
        round(ground.y),
        round(ground.z + drag.offset[1]),
      ],
      rotation: drag.rotation,
    };
  }

  private receive(message: ServerMessage): void {
    if (message.type === 'previewResult') this.previewed(message);
    else if (message.type === 'editResult') this.answered(message);
    else if (message.type === 'scene') {
      // The snapshot after a successful edit shows it; later presses use the snapshot again.
      for (const [ref, edit] of this.inFlight) if (edit.answered) this.inFlight.delete(ref);
      if (this.drag?.applied) this.cancelDrag();
    }
  }

  private previewed(result: Extract<ServerMessage, { type: 'previewResult' }>): void {
    if (!this.throttle.received(result.requestId)) return;
    const drag = this.drag;
    if (!drag || drag.applyId !== undefined) return;
    if (result.transform) drag.ghost.place(new Matrix4().fromArray(result.transform));
    drag.ghost.setState(result.ok ? 'ok' : 'blocked');
    if (result.ok) this.note.hide();
    else {
      const first = result.violations[0];
      this.note.show(
        this.t('edit.blocked'),
        first ? this.reasonOf(first) : undefined,
        drag.client.x,
        drag.client.y,
      );
    }
    this.viewport.invalidate();
  }

  private answered(result: Extract<ServerMessage, { type: 'editResult' }>): void {
    const pending = this.pending.get(result.requestId);
    if (!pending) return;
    this.pending.delete(result.requestId);
    for (const [ref, edit] of this.inFlight)
      if (edit.requestId === result.requestId) {
        if (result.ok) edit.answered = true;
        else this.inFlight.delete(ref);
      }
    const drag = this.drag;
    if (drag && drag.applyId === result.requestId) {
      if (result.ok) drag.applied = true;
      else this.cancelDrag();
    }
    if (result.ok) return;
    const reason = result.reason ?? '';
    if (pending.kind === 'apply') {
      const name = objectName(pending.ref, this.map.index);
      const key: MessageKey =
        pending.action === 'delete'
          ? 'edit.deleteRejected'
          : pending.action === 'rotate'
            ? 'edit.rotateRejected'
            : 'edit.moveRejected';
      this.toasts.show({
        level: 'warning',
        key: `edit:${pending.ref}`,
        text: (t) => t(key, { name }),
        detail: reason,
      });
    } else {
      const nothing = /^Nothing to (undo|redo)/i.test(reason);
      const undo = pending.kind === 'undo';
      this.toasts.show({
        level: nothing ? 'info' : 'warning',
        key: 'history',
        text: (t) =>
          nothing
            ? t(undo ? 'history.nothingToUndo' : 'history.nothingToRedo')
            : t(undo ? 'history.undoFailed' : 'history.redoFailed'),
        detail: nothing ? undefined : reason,
      });
    }
  }

  private disconnected(): void {
    const dropped = this.drag?.applyId !== undefined && !this.drag.applied;
    this.cancelDrag();
    this.pending.clear();
    this.inFlight.clear();
    this.throttle.reset();
    if (dropped) this.say('warning', 'edit.offline');
  }

  private rotationOf(ref: ObjectRef): number {
    const index = this.map.index;
    const structure = index?.structures.get(ref);
    if (structure) return yawOf(structure.transform);
    return normalizeAngle(index?.markers.get(ref)?.shape.rotation ?? 0);
  }

  private ground(pointer: Vector2): Vector3 | undefined {
    this.viewport.overview.apply(this.viewport.camera);
    this.raycaster.setFromCamera(pointer, this.viewport.camera);
    return this.map.groundPoint(this.raycaster);
  }

  private reasonOf(violation: ViolationView): string {
    return `${violationTitle(violation, this.t)} — ${violationMessage(violation, this.t)}`;
  }

  private t = (key: MessageKey, params?: Params): string =>
    translate(this.store.state.lang, key, params);

  private say(level: 'info' | 'warning', key: MessageKey): void {
    this.toasts.show({ level, key, text: (t) => t(key) });
  }
}
