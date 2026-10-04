import { EventEmitter } from 'node:events';
import type {
  Edit,
  HistoryEntry,
  ProjectInfo,
  SceneSnapshot,
  ServerMessage,
  ViolationView,
} from '@mapedit/protocol';
import { matrix, mockScene } from './mock.js';

export type Preview = Extract<ServerMessage, { type: 'previewResult' }>;
export interface StateStore {
  project: ProjectInfo;
  scene: SceneSnapshot;
  entries: HistoryEntry[];
  cursor: number;
  flush(): Promise<void>;
  openMap(id: string): Promise<void>;
  getScene?(id?: string): Promise<SceneSnapshot>;
  asset?(path: string): Uint8Array | undefined;
  preview(edit: Edit, requestId: number, mapId?: string): Promise<Preview>;
  apply(edit: Edit, baseRevision: number, mapId?: string): Promise<string | undefined>;
  travel(direction: -1 | 1): Promise<string | undefined>;
  on(event: 'message', listener: (message: ServerMessage) => void): this;
  close(): Promise<void>;
}

export class MemoryState extends EventEmitter implements StateStore {
  project: ProjectInfo = { name: 'Mock project', maps: [{ id: 'village', name: 'Mock village' }] };
  scene = mockScene();
  entries: HistoryEntry[] = [];
  cursor = 0;
  protected snapshots: SceneSnapshot[] = [structuredClone(this.scene)];
  protected lastAgent = new Map<string, number>();
  protected lastHuman = new Set<string>();
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
  async openMap(id: string): Promise<void> {
    if (id !== this.scene.map.id) throw new Error(`Map '${id}' does not exist.`);
  }
  broadcast(): void {
    this.emit('message', { type: 'scene', scene: this.scene } satisfies ServerMessage);
    this.emit('message', {
      type: 'history',
      entries: this.entries,
      cursor: this.cursor,
    } satisfies ServerMessage);
  }
  notice(
    code: Extract<ServerMessage, { type: 'notice' }>['code'],
    message: string,
    refs?: string[],
  ): void {
    this.emit('message', {
      type: 'notice',
      level: code === 'file_error' ? 'error' : 'warning',
      code,
      message,
      ...(refs ? { refs } : {}),
    } satisfies ServerMessage);
  }
  async preview(edit: Edit, requestId: number): Promise<Preview> {
    const violations: ViolationView[] = [];
    const exists =
      this.scene.structures.some(
        (s) => s.ref === edit.ref || s.instances.some((i) => i.ref === edit.ref),
      ) || this.scene.markers.some((m) => m.ref === edit.ref);
    if (!exists || (edit.kind === 'move' && edit.ref.startsWith('module:')))
      violations.push({
        id: 'missing',
        kind: 'missing_reference',
        message: 'Select an existing structure or marker to move.',
        params: {},
        refs: [edit.ref],
        suggestion: 'Reload the map and select an existing object.',
      });
    if (edit.kind === 'delete')
      return { type: 'previewResult', requestId, ok: true, violations: [] };
    const position = edit.position.map((v) => Math.round(v * 2) / 2) as [number, number, number];
    position[1] = 0;
    const rotation = Math.round(edit.rotation / 15) * 15;
    const extent = edit.ref.startsWith('structure:') ? 2 : 0;
    if (
      position[0] < 0 ||
      position[2] < 0 ||
      position[0] + extent > this.scene.map.size.x ||
      position[2] + extent > this.scene.map.size.z
    )
      violations.push({
        id: 'bounds',
        kind: 'out_of_bounds',
        message: 'The object would be outside the map.',
        params: { position },
        refs: [edit.ref],
        location: position,
        suggestion: 'Move the object inside the map.',
      });
    return {
      type: 'previewResult',
      requestId,
      ok: violations.length === 0,
      transform: matrix(position, rotation),
      violations,
    };
  }
  protected record(author: 'human' | 'agent', summary: string, files: string[]): void {
    this.entries.splice(this.cursor);
    this.snapshots.splice(this.cursor + 1);
    this.entries.push({
      id: (this.entries.at(-1)?.id ?? 0) + 1,
      author,
      time: new Date().toISOString(),
      summary,
      files,
    });
    this.snapshots.push(structuredClone(this.scene));
    this.cursor = this.entries.length;
  }
  async apply(edit: Edit, baseRevision: number): Promise<string | undefined> {
    const preview = await this.preview(edit, 0);
    if (!preview.ok) {
      this.notice('edit_rejected', preview.violations[0]!.message, [edit.ref]);
      return preview.violations[0]!.message;
    }
    const structure = this.scene.structures.find(
      (s) => s.ref === edit.ref || s.instances.some((i) => i.ref === edit.ref),
    );
    const marker = this.scene.markers.find((m) => m.ref === edit.ref);
    if (edit.kind === 'delete') {
      this.scene.structures = this.scene.structures.filter((s) => s.ref !== edit.ref);
      for (const s of this.scene.structures)
        s.instances = s.instances.filter((i) => i.ref !== edit.ref);
      this.scene.markers = this.scene.markers.filter((m) => m.ref !== edit.ref);
    } else if (structure && preview.transform) {
      const previous = structure.transform;
      const angle = Math.round(edit.rotation / 15) * 15;
      const oldAngle = (Math.atan2(-previous[2]!, previous[0]!) * 180) / Math.PI;
      const delta = ((angle - oldAngle) * Math.PI) / 180;
      for (const instance of structure.instances) {
        const x = instance.transform[12]! - previous[12]!,
          z = instance.transform[14]! - previous[14]!;
        instance.transform = matrix(
          [
            preview.transform[12]! + Math.cos(delta) * x + Math.sin(delta) * z,
            preview.transform[13]!,
            preview.transform[14]! - Math.sin(delta) * x + Math.cos(delta) * z,
          ],
          angle,
        );
      }
      structure.transform = preview.transform;
    } else if (marker && preview.transform) {
      const position: [number, number, number] = [
        preview.transform[12]!,
        preview.transform[13]!,
        preview.transform[14]!,
      ];
      if (marker.shape.kind === 'point') marker.shape.position = position;
      else marker.shape.center = position;
      marker.shape.rotation = Math.round(edit.rotation / 15) * 15;
    }
    this.scene.revision++;
    this.record('human', `${edit.kind === 'move' ? 'Move' : 'Delete'} ${edit.ref}`, [
      structure?.file ?? `maps/${this.scene.map.id}/markers.yaml`,
    ]);
    if ((this.lastAgent.get(edit.ref) ?? -1) > baseRevision)
      this.notice(
        'agent_change_overridden',
        'Your edit overrides an Agent change made while dragging.',
        [edit.ref],
      );
    this.lastHuman.add(edit.ref);
    return undefined;
  }
  async travel(direction: -1 | 1): Promise<string | undefined> {
    const target = this.cursor + direction;
    if (target < 0 || target > this.entries.length)
      return direction < 0 ? 'Nothing to undo.' : 'Nothing to redo.';
    const revision = this.scene.revision + 1;
    this.scene = structuredClone(this.snapshots[target]!);
    this.scene.revision = revision;
    this.cursor = target;
    return undefined;
  }
  replaceFromAgent(
    scene: SceneSnapshot,
    refs: string[],
    files = ['maps/village/structures/house.yaml'],
  ): void {
    const previousErrors = new Set(this.scene.fileErrors.map((error) => JSON.stringify(error)));
    const revision = this.scene.revision + 1;
    this.scene = structuredClone(scene);
    this.scene.revision = revision;
    this.record('agent', 'Update project files', files);
    for (const ref of refs) this.lastAgent.set(ref, revision);
    this.notice('agent_changed', 'Agent updated project files.', refs);
    const overwritten = refs.filter((ref) => this.lastHuman.has(ref));
    if (overwritten.length)
      this.notice(
        'overwritten_by_agent',
        'Agent changes overwrite recent human edits.',
        overwritten,
      );
    for (const ref of refs) this.lastHuman.delete(ref);
    for (const error of scene.fileErrors)
      if (!previousErrors.has(JSON.stringify(error))) this.notice('file_error', error.message);
    this.broadcast();
  }
}
