import { EventEmitter } from 'node:events';
import { transformMatrix, createViolation, exceededMapEdges, snapMove } from '@mapedit/core';
import { parseObjectRef, markerPosition } from '@mapedit/protocol';
import type {
  Edit,
  HistoryEntry,
  ProjectInfo,
  SceneSnapshot,
  ServerMessage,
  Vec3,
  ViolationView,
  NoticeCode,
} from '@mapedit/protocol';
import { mockScene, mockAsset } from './mock.js';
import { ProjectHistory } from './history.js';
import { noticeMessage } from './notice.js';
import { createMockServices, triggerMockNotice } from './mock-services.js';
import type { AgentServices } from './mcp.js';
import type { ScreenshotService } from './screenshot.js';

export type Preview = Extract<ServerMessage, { type: 'previewResult' }>;
/** The mock terrain is one flat chunk whose surface is at height 0. */
const mockTerrainHeight = (): number => 0;
export interface StateStore {
  project: ProjectInfo;
  scene: SceneSnapshot;
  entries: HistoryEntry[];
  cursor: number;
  flush(): Promise<void>;
  openMap(id: string): Promise<void>;
  getScene(id?: string): Promise<SceneSnapshot>;
  asset(path: string): Uint8Array | undefined;
  createAgentServices(screenshots: ScreenshotService): AgentServices;
  triggerMockNotice?(code: NoticeCode): Promise<void>;
  preview(edit: Edit, requestId: number, mapId?: string): Promise<Preview>;
  apply(edit: Edit, baseRevision: number, mapId?: string): Promise<string | undefined>;
  travel(direction: -1 | 1): Promise<string | undefined>;
  on(event: 'message', listener: (message: ServerMessage) => void): this;
  close(): Promise<void>;
}

export class MemoryState extends EventEmitter implements StateStore {
  project: ProjectInfo = { name: 'Mock project', maps: [{ id: 'village', name: 'Mock village' }] };
  scene = mockScene();
  protected readonly history = new ProjectHistory(structuredClone(this.scene));
  get entries(): HistoryEntry[] {
    return this.history.entries;
  }
  get cursor(): number {
    return this.history.cursor;
  }
  protected lastAgent = new Map<string, number>();
  protected lastHuman = new Set<string>();
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
  async openMap(id: string): Promise<void> {
    await this.getScene(id);
  }
  async getScene(id = this.scene.map.id): Promise<SceneSnapshot> {
    if (id !== this.scene.map.id) throw new Error(`Map '${id}' does not exist.`);
    return this.scene;
  }
  asset(path: string): Uint8Array | undefined {
    return mockAsset(path);
  }
  createAgentServices(screenshots: ScreenshotService): AgentServices {
    return createMockServices(this, screenshots);
  }
  triggerMockNotice(code: NoticeCode): Promise<void> {
    return triggerMockNotice(this, code);
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
    this.emit('message', noticeMessage(code, message, refs));
  }
  async preview(edit: Edit, requestId: number): Promise<Preview> {
    const violations: ViolationView[] = [];
    const object = parseObjectRef(edit.ref);
    const exists =
      this.scene.structures.some(
        (s) => s.ref === edit.ref || s.instances.some((i) => i.ref === edit.ref),
      ) || this.scene.markers.some((m) => m.ref === edit.ref);
    // A stale or malformed ref gets exactly one missing_reference, as in protocol section 4.
    if (!exists || (edit.kind === 'move' && object?.kind === 'module'))
      return {
        type: 'previewResult',
        requestId,
        ok: false,
        violations: [
          createViolation({
            kind: 'missing_reference',
            message: exists
              ? `Move the whole Structure; ${edit.ref} is a Module inside it.`
              : `Unknown object "${edit.ref}".`,
            params: { reason: exists ? 'immovable_object' : 'unknown_object', reference: edit.ref },
            refs: [edit.ref],
            suggestion: 'Reload the map and select an existing structure or marker.',
            rule: 'mock-preview-reference',
          }),
        ],
      };
    if (edit.kind === 'delete') return { type: 'previewResult', requestId, ok: true, violations };
    // The same height rule as the real editor, on the mock's flat terrain at height 0.
    const marker = this.scene.markers.find((item) => item.ref === edit.ref);
    const { position, rotation } = snapMove(
      edit,
      marker ? { markerPosition: markerPosition(marker.shape) } : {},
      mockTerrainHeight,
    );
    // Mock Structures are one 2 m block; Markers are checked at their position.
    const extent = object?.kind === 'structure' ? 2 : 0;
    const bounds = {
      min: position,
      max: [position[0] + extent, position[1] + extent, position[2] + extent] as Vec3,
    };
    const edges = exceededMapEdges(bounds, this.scene.map.size);
    if (edges.length)
      violations.push(
        createViolation({
          kind: 'out_of_bounds',
          message: 'The object would be outside the map.',
          params: { edges, bounds, size: this.scene.map.size },
          refs: [edit.ref],
          location: position,
          suggestion: 'Move the object inside the map.',
          rule: 'mock-preview-bounds',
        }),
      );
    return {
      type: 'previewResult',
      requestId,
      ok: violations.length === 0,
      transform: transformMatrix(position, rotation),
      violations,
    };
  }
  protected record(author: 'human' | 'agent', summary: string, files: string[]): void {
    this.history.record({ author, summary, files }, structuredClone(this.scene));
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
      const angle = snapMove(edit, {}, mockTerrainHeight).rotation;
      const oldAngle = (Math.atan2(-previous[2]!, previous[0]!) * 180) / Math.PI;
      const delta = ((angle - oldAngle) * Math.PI) / 180;
      for (const instance of structure.instances) {
        const x = instance.transform[12]! - previous[12]!,
          z = instance.transform[14]! - previous[14]!;
        instance.transform = transformMatrix(
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
      const coordinates = markerPosition(marker.shape);
      coordinates.splice(0, 3, ...position);
      marker.shape.rotation = snapMove(edit, {}, mockTerrainHeight).rotation;
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
    const target = this.history.target(direction);
    if (!target) return direction < 0 ? 'Nothing to undo.' : 'Nothing to redo.';
    const revision = this.scene.revision + 1;
    this.scene = structuredClone(target.snapshot);
    this.scene.revision = revision;
    this.history.cursor = target.cursor;
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
