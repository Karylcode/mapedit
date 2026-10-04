import { EventEmitter } from 'node:events';
import { readFile, writeFile, readdir, mkdir, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, sep, dirname, isAbsolute, posix } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import { parseProject, applySourceEdit, normalizeEdit, type ParsedProject } from '@mapedit/core';
import type {
  Edit,
  HistoryEntry,
  ProjectInfo,
  SceneSnapshot,
  ServerMessage,
} from '@mapedit/protocol';
import { matrix } from './mock.js';
import type { Preview, StateStore } from './state.js';
import type { BuiltProject } from './build-project.js';

export type ProjectBuild = BuiltProject;
export interface DiskStateBuilder {
  build(mapId: string | undefined, revision: number): Promise<ProjectBuild>;
  preview(
    parsed: ParsedProject,
    mapId: string,
    revision: number,
    cached: ProjectBuild,
  ): Promise<ProjectBuild>;
}
interface Checkpoint {
  files: Map<string, Buffer>;
}

/** Project-wide source history. Immutable Buffer references make checkpoints cheap. */
export class DiskState extends EventEmitter implements StateStore {
  project!: ProjectInfo;
  scene!: SceneSnapshot;
  entries: HistoryEntry[] = [];
  cursor = 0;
  readonly builds = new Map<string, ProjectBuild>();
  readonly previewScenes = new Map<string, SceneSnapshot>();
  private checkpoints: Checkpoint[] = [];
  private baseline = new Map<string, Buffer>();
  private watcher?: FSWatcher;
  private revision = 0;
  private busy = Promise.resolve();
  private closed = false;
  private lastAgent = new Map<string, number>();
  private lastHuman = new Set<string>();
  private nextHistoryId = 1;
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
    state.checkpoints.push({ files: new Map(state.baseline) });
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
  private install(build: ProjectBuild): void {
    this.project = build.parsed.info;
    this.scene = build.scene;
    this.builds.set(build.scene.map.id, build);
  }
  private async readInputs(): Promise<Map<string, Buffer>> {
    const found = new Map<string, Buffer>();
    const projectStat = await lstat(resolve(this.root, 'project.yaml')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (projectStat?.isSymbolicLink())
      throw new Error('Symbolic links are not supported in authoring inputs: project.yaml');
    const walk = async (folder: string): Promise<void> => {
      const directory = resolve(this.root, folder);
      const metadata = await lstat(directory).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!metadata) return;
      if (metadata.isSymbolicLink())
        throw new Error(`Symbolic links are not supported in authoring inputs: ${folder}`);
      const physical = await realpath(directory),
        inside = relative(this.root, physical);
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
        throw new Error(`Authoring input directory is outside the project: ${folder}`);
      const entries = await readdir(resolve(this.root, folder), { withFileTypes: true }).catch(
        (error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
          throw error;
        },
      );
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const name = folder ? `${folder}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          throw new Error(`Symbolic links are not supported in authoring inputs: ${name}`);
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile() && /\.(?:ya?ml|ts|png)$/i.test(entry.name)) {
          const content = await readFile(resolve(this.root, name));
          const old = this.baseline.get(name);
          found.set(name, old?.equals(content) ? old : content);
        }
      }
    };
    const project = await readFile(resolve(this.root, 'project.yaml')).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (project) {
      const old = this.baseline.get('project.yaml');
      found.set('project.yaml', old?.equals(project) ? old : project);
    }
    await walk('modules');
    await walk('maps');
    return found;
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
  ): void {
    this.emit('message', {
      type: 'notice',
      level: code === 'file_error' ? 'error' : 'warning',
      code,
      message,
      ...(refs ? { refs } : {}),
    } satisfies ServerMessage);
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
  private record(author: 'human' | 'agent', summary: string, files: string[]): void {
    this.entries.splice(this.cursor);
    this.checkpoints.splice(this.cursor + 1);
    this.entries.push({
      id: this.nextHistoryId++,
      author,
      time: new Date().toISOString(),
      summary,
      files,
    });
    this.checkpoints.push({ files: new Map(this.baseline) });
    this.cursor = this.entries.length;
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
    this.record('agent', 'Update project files', changed);
    for (const key of refs.keys()) this.lastAgent.set(key, this.revision);
    this.notice('agent_changed', 'Agent updated project files.', [...refs.values()]);
    const overwritten = [...refs].filter(([key]) => this.lastHuman.has(key)).map(([, ref]) => ref);
    if (overwritten.length)
      this.notice(
        'overwritten_by_agent',
        'Agent changes overwrite recent human edits.',
        overwritten,
      );
    for (const key of refs.keys()) this.lastHuman.delete(key);
    this.broadcast();
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
    for (const error of this.scene.fileErrors)
      this.notice(
        'file_error',
        `${error.file}${error.line ? `:${error.line}` : ''}: ${error.message}`,
      );
  }
  async getScene(id?: string): Promise<SceneSnapshot> {
    const mapId = id ?? this.scene.map.id;
    const preview = this.previewScenes.get(mapId);
    if (preview) return preview;
    let build = this.builds.get(mapId);
    if (!build) {
      build = await this.builder.build(mapId, this.revision);
      this.builds.set(mapId, build);
    }
    return build.scene;
  }
  async getBuild(id?: string): Promise<ProjectBuild> {
    await this.getScene(id);
    return this.builds.get(id ?? this.scene.map.id)!;
  }
  async openMap(id: string): Promise<void> {
    this.scene = await this.getScene(id);
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
    const normalized = normalizeEdit(cached.parsed, mapId, edit, cached.heightAt);
    if (edit.kind === 'delete')
      return { type: 'previewResult', requestId, ok: true, violations: [] };
    try {
      const files = {
        ...cached.parsed.files,
        ...applySourceEdit(cached.parsed, mapId, normalized),
      };
      const parsed = parseProject(files);
      const candidate = await this.builder.preview(parsed, mapId, this.revision, cached);
      const before = new Set(cached.scene.violations.map((v) => JSON.stringify(v)));
      const target = candidate.scene.structures.find((s) => s.ref === edit.ref);
      const marker = candidate.scene.markers.find((m) => m.ref === edit.ref);
      const refs = new Set([edit.ref, ...(target?.instances.map((i) => i.ref) ?? [])]);
      const violations = candidate.scene.violations.filter(
        (v) => v.refs.some((ref) => refs.has(ref)) || !before.has(JSON.stringify(v)),
      );
      if (candidate.scene.fileErrors.length)
        throw new Error(candidate.scene.fileErrors[0]!.message);
      const transform =
        target?.transform ??
        (marker
          ? matrix(
              marker.shape.kind === 'point' ? marker.shape.position : marker.shape.center,
              marker.shape.rotation,
            )
          : undefined);
      return {
        type: 'previewResult',
        requestId,
        ok: violations.length === 0,
        violations,
        ...(transform ? { transform } : {}),
      };
    } catch (error) {
      return {
        type: 'previewResult',
        requestId,
        ok: false,
        violations: [
          {
            id: 'edit:missing',
            kind: 'missing_reference',
            message: error instanceof Error ? error.message : String(error),
            params: {},
            refs: [edit.ref],
            suggestion: 'Reload the map and select an existing object.',
          },
        ],
      };
    }
  }
  private async safeWrite(file: string, data: Buffer | undefined): Promise<void> {
    const target = resolve(this.root, file);
    const rel = relative(this.root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('Cannot write outside the project.');
    const existing = await realpath(target).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (existing) {
      const inside = relative(this.root, existing);
      if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
        throw new Error('Cannot write through a link outside the project.');
    }
    let parent = dirname(target);
    while (true) {
      try {
        const resolved = await realpath(parent);
        const inside = relative(this.root, resolved);
        if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside))
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
  ): Promise<string | undefined> {
    return this.serial(async () => {
      await this.refresh();
      const preview = await this.preview(edit, 0, mapId);
      if (!preview.ok) {
        const reason = preview.violations[0]?.message ?? 'Edit rejected.';
        this.notice('edit_rejected', reason, [edit.ref]);
        return reason;
      }
      const build = await this.getBuild(mapId);
      const normalized = normalizeEdit(build.parsed, mapId, edit, build.heightAt);
      let changed: Record<string, string>;
      try {
        changed = applySourceEdit(build.parsed, mapId, normalized);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.notice('edit_rejected', reason, [edit.ref]);
        return reason;
      }
      for (const [file, content] of Object.entries(changed))
        await this.safeWrite(file, Buffer.from(content));
      this.baseline = await this.readInputs();
      this.revision++;
      await this.rebuild();
      this.record(
        'human',
        `${edit.kind === 'move' ? 'Move' : 'Delete'} ${edit.ref}`,
        Object.keys(changed),
      );
      if ((this.lastAgent.get(`${mapId}\0${edit.ref}`) ?? -1) > baseRevision)
        this.notice(
          'agent_change_overridden',
          'Your edit overrides an Agent change made while dragging.',
          [edit.ref],
        );
      this.lastHuman.add(`${mapId}\0${edit.ref}`);
      return undefined;
    });
  }
  async travel(direction: -1 | 1): Promise<string | undefined> {
    return this.serial(async () => {
      await this.refresh();
      const target = this.cursor + direction;
      if (target < 0 || target > this.entries.length)
        return direction < 0 ? 'Nothing to undo.' : 'Nothing to redo.';
      const desired = this.checkpoints[target]!.files;
      for (const file of this.changed(this.baseline, desired))
        await this.safeWrite(file, desired.get(file));
      this.baseline = new Map(desired);
      this.cursor = target;
      this.revision++;
      await this.rebuild();
      return undefined;
    });
  }
  async writeAgentFiles(files: Record<string, Uint8Array | string>): Promise<void> {
    await this.updateAgentFiles(async () => files);
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
