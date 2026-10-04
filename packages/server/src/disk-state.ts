import { EventEmitter } from 'node:events';
import { writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { resolve, dirname, posix } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  parseProject,
  applySourceEdit,
  normalizeEdit,
  transformMatrix,
  createViolation,
  EditError,
  type ParsedProject,
} from '@mapedit/core';
import type {
  Edit,
  EditFailure,
  HistoryEntry,
  ProjectInfo,
  SceneSnapshot,
  ServerMessage,
  ViolationView,
} from '@mapedit/protocol';
import { markerPosition } from '@mapedit/protocol';
import type { Preview, StateStore } from './state.js';
import type { BuiltProject } from './build-project.js';
import { readProjectInputs } from './project-files.js';
import { containsPath } from './paths.js';
import { ProjectHistory, type EditRefusal } from './history.js';
import { UnknownMapError, noticeMessage } from './notice.js';
import { createAgentServices } from './services.js';
import type { AgentServices } from './mcp.js';
import type { ScreenshotService } from './screenshot.js';

export interface DiskStateBuilder {
  build(mapId: string | undefined, revision: number): Promise<BuiltProject>;
  preview(
    parsed: ParsedProject,
    mapId: string,
    revision: number,
    cached: BuiltProject,
  ): Promise<BuiltProject>;
}
interface Checkpoint {
  files: Map<string, Buffer>;
}

/** Project-wide source history. Immutable Buffer references make checkpoints cheap. */
export class DiskState extends EventEmitter implements StateStore {
  project!: ProjectInfo;
  scene!: SceneSnapshot;
  private history!: ProjectHistory<Checkpoint>;
  get entries(): HistoryEntry[] {
    return this.history.entries;
  }
  get cursor(): number {
    return this.history.cursor;
  }
  readonly builds = new Map<string, BuiltProject>();
  readonly previewScenes = new Map<string, SceneSnapshot>();
  private baseline = new Map<string, Buffer>();
  private watcher?: FSWatcher;
  private revision = 0;
  /** Counts every processed change of the project's authoring files. */
  get projectRevision(): number {
    return this.revision;
  }
  private busy = Promise.resolve();
  private closed = false;
  private lastAgent = new Map<string, number>();
  private lastHuman = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private constructor(
    readonly root: string,
    private readonly builder: DiskStateBuilder,
  ) {
    super();
  }
  static async create(root: string, builder: DiskStateBuilder): Promise<DiskState> {
    const state = new DiskState(await realpath(root), builder);
    state.baseline = await state.readInputs();
    state.history = new ProjectHistory({ files: new Map(state.baseline) });
    const build = await builder.build(undefined, 0);
    state.install(build);
    state.watcher = watch(
      [resolve(root, 'project.yaml'), resolve(root, 'modules'), resolve(root, 'maps')],
      {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
        ignored: (path) => /(?:^|[\\/])(?:node_modules|\.mapedit)(?:[\\/]|$)/.test(path),
      },
    );
    state.watcher.on('all', () => {
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        void state.flush().catch((error) => state.notice('file_error', String(error)));
      }, 75);
    });
    state.watcher.on('error', (error) => state.notice('file_error', String(error)));
    return state;
  }
  private install(build: BuiltProject): void {
    this.project = build.parsed.info;
    this.scene = build.scene;
    this.builds.set(build.scene.map.id, build);
  }
  private async readInputs(): Promise<Map<string, Buffer>> {
    return readProjectInputs(this.root, { previous: this.baseline });
  }
  private changed(a: Map<string, Buffer>, b: Map<string, Buffer>): string[] {
    return [...new Set([...a.keys(), ...b.keys()])]
      .filter(
        (file) =>
          a.get(file) !== b.get(file) &&
          !(a.get(file) && b.get(file) && a.get(file)!.equals(b.get(file)!)),
      )
      .sort();
  }
  private refsFor(files: string[]): Map<string, string> {
    const refs = new Map<string, string>();
    for (const build of this.builds.values()) {
      const add = (ref: string) => refs.set(`${build.scene.map.id}\0${ref}`, ref);
      for (const [ref, source] of Object.entries(build.compilation.sourceRefs))
        if (files.includes(source.file)) add(ref);
      if (
        files.some(
          (file) =>
            file.startsWith('modules/') ||
            file.startsWith(
              `${posix.dirname(build.parsed.maps[build.scene.map.id]?.source.file ?? `maps/${build.scene.map.id}/map.yaml`)}/terrain/`,
            ),
        )
      )
        for (const structure of build.scene.structures) {
          add(structure.ref);
          for (const instance of structure.instances) add(instance.ref);
        }
    }
    return refs;
  }
  private objectSignatures(): Map<string, string> {
    const result = new Map<string, string>();
    for (const build of this.builds.values()) {
      for (const structure of build.scene.structures) {
        result.set(`${build.scene.map.id}\0${structure.ref}`, JSON.stringify(structure));
        for (const instance of structure.instances)
          result.set(`${build.scene.map.id}\0${instance.ref}`, JSON.stringify(instance));
      }
      for (const marker of build.scene.markers)
        result.set(`${build.scene.map.id}\0${marker.ref}`, JSON.stringify(marker));
    }
    return result;
  }
  private notice(
    code: Extract<ServerMessage, { type: 'notice' }>['code'],
    message: string,
    refs?: string[],
    mapId?: string,
  ): void {
    this.emit('message', noticeMessage(code, message, refs, mapId));
  }
  /** One notice per map for refs keyed by `<mapId>\0<ref>`, so each names its map. */
  private noticePerMap(
    code: 'agent_changed' | 'overwritten_by_agent',
    message: string,
    refs: Iterable<[string, string]>,
  ): void {
    const byMap = new Map<string, string[]>();
    for (const [key, ref] of refs) {
      const mapId = key.split('\0')[0]!;
      byMap.set(mapId, [...(byMap.get(mapId) ?? []), ref]);
    }
    if (!byMap.size) this.notice(code, message, []);
    for (const [mapId, mapRefs] of byMap) this.notice(code, message, mapRefs, mapId);
  }
  private noticeFileErrors(): void {
    for (const error of this.scene.fileErrors)
      this.notice(
        'file_error',
        `${error.file}${error.line ? `:${error.line}` : ''}: ${error.message}`,
      );
  }
  private broadcast(): void {
    for (const build of this.builds.values())
      this.emit('message', { type: 'scene', scene: build.scene } satisfies ServerMessage);
    this.emit('message', {
      type: 'history',
      entries: this.entries,
      cursor: this.cursor,
    } satisfies ServerMessage);
  }
  private record(
    entry: Pick<HistoryEntry, 'author' | 'summary' | 'files' | 'action' | 'refs'>,
  ): void {
    this.history.record(entry, { files: new Map(this.baseline) });
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.busy.then(operation);
    this.busy = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async flush(): Promise<void> {
    return this.serial(() => this.refresh());
  }
  private async refresh(): Promise<void> {
    if (this.closed) return;
    const current = await this.readInputs();
    const changed = this.changed(this.baseline, current);
    if (!changed.length) return;
    const candidates = this.refsFor(changed);
    const before = this.objectSignatures();
    this.baseline = current;
    this.revision++;
    await this.rebuild();
    const after = this.objectSignatures();
    const refs = new Map(
      [...candidates].filter(
        ([key]) =>
          before.get(key) !== after.get(key) || changed.some((file) => file.startsWith('modules/')),
      ),
    );
    for (const key of after.keys()) if (!before.has(key)) refs.set(key, key.split('\0')[1]!);
    this.record({
      author: 'agent',
      summary: 'Update project files',
      files: changed,
      action: 'agent_change',
      refs: [...refs.values()],
    });
    for (const key of refs.keys()) this.lastAgent.set(key, this.revision);
    const overwritten = [...refs].filter(([key]) => this.lastHuman.has(key));
    for (const key of refs.keys()) this.lastHuman.delete(key);
    // The new scenes come first, so editors find the refs in the snapshot that has them.
    this.broadcast();
    this.noticePerMap('agent_changed', 'Agent updated project files.', refs);
    if (overwritten.length)
      this.noticePerMap(
        'overwritten_by_agent',
        'Agent changes overwrite recent human edits.',
        overwritten,
      );
    this.noticeFileErrors();
  }
  private async rebuild(): Promise<void> {
    const ids = [...this.builds.keys()];
    const selected = this.scene.map.id;
    for (const id of ids) {
      const build = await this.builder.build(id, this.revision);
      this.builds.set(id, build);
    }
    const build = this.builds.get(selected) ?? (await this.builder.build(undefined, this.revision));
    this.install(build);
  }
  async getScene(id?: string): Promise<SceneSnapshot> {
    const mapId = id ?? this.scene.map.id;
    const preview = this.previewScenes.get(mapId);
    if (preview) return preview;
    let build = this.builds.get(mapId);
    if (!build) {
      // Only maps of the project are built and cached (protocol section 4, flow 2).
      if (!this.isProjectMap(mapId)) throw new UnknownMapError(mapId);
      build = await this.builder.build(mapId, this.revision);
      this.builds.set(mapId, build);
    }
    return build.scene;
  }
  /** A listed map, or the directory of a map.yaml that cannot be read, whose scene shows why. */
  private isProjectMap(mapId: string): boolean {
    if (this.project.maps.some((map) => map.id === mapId)) return true;
    const parsed = this.builds.get(this.scene.map.id)?.parsed;
    if (!parsed) return false;
    const files = [`maps/${mapId}/map.yaml`, `maps/${mapId}/map.yml`].filter((file) =>
      Object.hasOwn(parsed.files, file),
    );
    return (
      files.length > 0 && !Object.values(parsed.maps).some((map) => files.includes(map.source.file))
    );
  }
  async getBuild(id?: string): Promise<BuiltProject> {
    await this.getScene(id);
    return this.builds.get(id ?? this.scene.map.id)!;
  }
  async openMap(id: string): Promise<void> {
    this.scene = await this.getScene(id);
  }
  createAgentServices(screenshots: ScreenshotService): AgentServices {
    return createAgentServices(this, screenshots);
  }
  asset(path: string): Uint8Array | undefined {
    for (const build of this.builds.values()) {
      const found = build.assets.get(path);
      if (found) return found;
    }
    return undefined;
  }
  async preview(edit: Edit, requestId: number, mapId = this.scene.map.id): Promise<Preview> {
    const cached = await this.getBuild(mapId);
    const refuse = (failure: EditFailure, violations: ViolationView[] = []): Preview => ({
      type: 'previewResult',
      requestId,
      ok: false,
      violations,
      failure,
    });
    try {
      if (edit.kind === 'delete') {
        if (!Object.hasOwn(cached.compilation.sourceRefs, edit.ref))
          throw new EditError(`Unknown object "${edit.ref}".`, 'unknown_object');
        return { type: 'previewResult', requestId, ok: true, violations: [] };
      }
      // Any unreadable project file blocks moves until it is fixed (protocol section 4, flow 9).
      if (cached.scene.fileErrors.length) return refuse('file_errors');
      const normalized = normalizeEdit(cached.parsed, mapId, edit, cached.heightAt);
      const files = {
        ...cached.parsed.files,
        ...applySourceEdit(cached.parsed, mapId, normalized),
      };
      const parsed = parseProject(files);
      const candidate = await this.builder.preview(parsed, mapId, this.revision, cached);
      const before = new Set(cached.scene.violations.map((v) => v.id));
      const target = candidate.scene.structures.find((s) => s.ref === edit.ref);
      const marker = candidate.scene.markers.find((m) => m.ref === edit.ref);
      const refs = new Set([edit.ref, ...(target?.instances.map((i) => i.ref) ?? [])]);
      const violations = candidate.scene.violations.filter(
        (v) => v.refs.some((ref) => refs.has(ref)) || !before.has(v.id),
      );
      if (candidate.scene.fileErrors.length) return refuse('file_errors');
      const transform =
        target?.transform ??
        (marker ? transformMatrix(markerPosition(marker.shape), marker.shape.rotation) : undefined);
      return {
        type: 'previewResult',
        requestId,
        ok: violations.length === 0,
        violations,
        ...(transform ? { transform } : {}),
        ...(violations.length ? { failure: 'violations' as const } : {}),
      };
    } catch (error) {
      if (!(error instanceof EditError)) throw error;
      if (error.failure === 'file_errors') return refuse('file_errors');
      // A stale or malformed ref, or an object that only moves with its Structure, is
      // answered as one missing_reference (protocol section 4, flow 7).
      return refuse(error.failure, [
        createViolation({
          kind: 'missing_reference',
          message: error.message,
          params: { reason: error.failure, reference: edit.ref },
          refs: [edit.ref],
          suggestion:
            error.failure === 'immovable_object'
              ? 'Move the whole Structure that contains it instead.'
              : 'Reload the map and select an existing object.',
          rule: 'edit-reference',
        }),
      ]);
    }
  }
  /** The English reason for an edit blocked by file errors, naming the first one. */
  private fileErrorReason(build: BuiltProject): string {
    const first = build.scene.fileErrors[0];
    return first
      ? `Fix the project file errors before moving objects. ${first.file}:${first.line ?? 1}: ${first.message}`
      : 'Fix the project file errors before moving objects.';
  }
  private async safeWrite(file: string, data: Buffer | undefined): Promise<void> {
    const target = resolve(this.root, file);
    if (!containsPath(this.root, target)) throw new Error('Cannot write outside the project.');
    const existing = await realpath(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing) {
      if (!containsPath(this.root, existing))
        throw new Error('Cannot write through a link outside the project.');
    }
    let parent = dirname(target);
    while (true) {
      try {
        const resolved = await realpath(parent);
        if (!containsPath(this.root, resolved))
          throw new Error('Cannot write through a link outside the project.');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        parent = dirname(parent);
      }
    }
    if (data) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    } else await rm(target, { force: true });
  }
  async apply(
    edit: Edit,
    baseRevision: number,
    mapId = this.scene.map.id,
  ): Promise<EditRefusal | undefined> {
    return this.serial(async () => {
      await this.refresh();
      const preview = await this.preview(edit, 0, mapId);
      const build = await this.getBuild(mapId);
      if (!preview.ok) {
        const failure = preview.failure ?? 'violations';
        const reason =
          failure === 'file_errors'
            ? this.fileErrorReason(build)
            : (preview.violations[0]?.message ?? 'Edit rejected.');
        this.notice('edit_rejected', reason, [edit.ref], mapId);
        return { reason, failure };
      }
      const normalized = normalizeEdit(build.parsed, mapId, edit, build.heightAt);
      let changed: Record<string, string>;
      try {
        changed = applySourceEdit(build.parsed, mapId, normalized);
      } catch (error) {
        if (!(error instanceof EditError)) throw error;
        this.notice('edit_rejected', error.message, [edit.ref], mapId);
        return { reason: error.message, failure: error.failure };
      }
      for (const [file, content] of Object.entries(changed))
        await this.safeWrite(file, Buffer.from(content));
      this.baseline = await this.readInputs();
      this.revision++;
      await this.rebuild();
      this.noticeFileErrors();
      this.record({
        author: 'human',
        summary: `${edit.kind === 'move' ? 'Move' : 'Delete'} ${edit.ref}`,
        files: Object.keys(changed),
        action: edit.kind,
        refs: [edit.ref],
      });
      if ((this.lastAgent.get(`${mapId}\0${edit.ref}`) ?? -1) > baseRevision)
        this.notice(
          'agent_change_overridden',
          'Your edit overrides an Agent change made while dragging.',
          [edit.ref],
          mapId,
        );
      this.lastHuman.add(`${mapId}\0${edit.ref}`);
      return undefined;
    });
  }
  async travel(direction: -1 | 1): Promise<EditRefusal | undefined> {
    return this.serial(async () => {
      await this.refresh();
      // The cursor moves once the checkpoint's files are on disk.
      const reason = await this.history.travel(direction, async ({ files }) => {
        for (const file of this.changed(this.baseline, files))
          await this.safeWrite(file, files.get(file));
        this.baseline = new Map(files);
      });
      if (reason) return reason;
      this.revision++;
      await this.rebuild();
      this.noticeFileErrors();
      return undefined;
    });
  }
  /** Calculate from the latest build and commit both PNGs inside one project transaction. */
  async updateAgentFiles(
    update: () => Promise<Record<string, Uint8Array | string>>,
  ): Promise<void> {
    await this.serial(async () => {
      await this.refresh();
      const files = await update();
      for (const [file, content] of Object.entries(files))
        await this.safeWrite(
          file,
          typeof content === 'string' ? Buffer.from(content) : Buffer.from(content),
        );
      await this.refresh();
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    await this.watcher?.close();
    await this.busy;
  }
}
