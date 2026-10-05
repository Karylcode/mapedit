import {
  Box3,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  Plane,
  Raycaster,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import {
  markerPosition,
  type GeneratedMeshView,
  type InstanceView,
  type ObjectRef,
  type RenderStyle,
  type SceneSnapshot,
  type TerrainView,
  type ViolationView,
} from '@mapedit/protocol';
import type { Asset, AssetCache } from './assets.js';
import { isEstimated, SnapshotIndex, violatingRefs } from './snapshot-index.js';
import { ModuleBatches, type ModelState } from './module-batches.js';
import { MarkerLayer } from './marker-layer.js';
import { ViolationMarks } from './violation-marks.js';
import { palette } from './palette.js';
import { sunDirection } from './sun.js';
import { BoxOutlines, type OrientedBox } from './outline.js';
import { toonMaterial } from './toon.js';

export type OutlineLayer = 'selection' | 'hover' | 'focus' | 'flash';

export interface PickHit {
  ref: ObjectRef;
  point: Vector3;
  distance: number;
}

const scratch = new Matrix4();

/**
 * Everything drawn for one map snapshot: terrain and generated meshes here,
 * modules, markers and violation marks in their own classes. A new snapshot
 * only reloads what changed: terrain chunks, generated meshes and module models
 * by URL. A model that arrives redraws the modules only, and singling out a
 * violation changes only its flag and outline.
 */
export class MapView {
  readonly root = new Group();
  readonly sun = new DirectionalLight(palette.sun, 2.3);
  readonly hemisphere = new HemisphereLight(palette.skyLight, palette.groundLight, 2.4);
  readonly violationMarks = new ViolationMarks();
  /** Chalk-line outlines, drawn over everything so they stay visible. */
  readonly outlines: Record<OutlineLayer, { lines: BoxOutlines; refs: readonly ObjectRef[] }> = {
    selection: { lines: new BoxOutlines(palette.chalkline, 3), refs: [] },
    hover: { lines: new BoxOutlines(palette.chalkline, 2, { opacity: 0.55 }), refs: [] },
    focus: { lines: new BoxOutlines(palette.flag, 4), refs: [] },
    flash: { lines: new BoxOutlines(palette.chalkline, 2, { opacity: 0.8 }), refs: [] },
  };
  index?: SnapshotIndex;
  /** Whether violations get red tints and flags (the render page may turn this off). */
  showViolations = true;

  private readonly terrainGroup = new Group();
  private readonly generatedGroup = new Group();
  private readonly modules = new ModuleBatches((material) => this.look(material));
  private readonly markers = new MarkerLayer();
  private readonly terrain = new Map<string, { url: string; meshes: Mesh[] }>();
  private readonly terrainMaterials = new Map<string, Material>();
  private readonly generated = new Map<string, Mesh[]>();
  private readonly failed = new Set<string>();
  /** Module type URLs with a load in flight; each gets one callback. */
  private readonly loadingTypes = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private focusedViolation?: string;
  private generation = 0;
  private mapId?: string;
  private style: RenderStyle = 'standard';
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly assets: AssetCache) {
    this.root.name = 'map';
    this.terrainGroup.name = 'terrain';
    this.generatedGroup.name = 'generated';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.root.add(
      this.hemisphere,
      this.sun,
      this.sun.target,
      this.terrainGroup,
      this.modules.group,
      this.generatedGroup,
      this.markers.group,
      ...this.violationMarks.objects,
      ...Object.values(this.outlines).map((layer) => layer.lines),
    );
  }

  /**
   * Outline objects: the selection, what a click would select, the violation
   * picked in the list, or what the Agent just changed.
   */
  setOutlines(layer: OutlineLayer, refs: readonly ObjectRef[]): void {
    this.outlines[layer].refs = refs;
    this.outlines[layer].lines.setBoxes(refs.flatMap((ref) => this.boxesFor(ref)));
    this.changed();
  }

  /** Line widths are in pixels, so outlines need the drawing buffer size. */
  setResolution(width: number, height: number): void {
    this.violationMarks.setResolution(width, height);
    for (const layer of Object.values(this.outlines)) layer.lines.setResolution(width, height);
  }

  get scene(): SceneSnapshot | undefined {
    return this.index?.scene;
  }

  /** Listen for visible changes, including asynchronous ones such as a finished asset load. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.changeListeners]) listener();
  }

  apply(scene: SceneSnapshot): void {
    const style = scene.style ?? 'standard';
    // A new style rebuilds every mesh from the cached assets with the other materials.
    if (scene.map.id !== this.mapId || style !== this.style) this.clear();
    this.mapId = scene.map.id;
    this.style = style;
    this.generation++;
    // Each snapshot asks again for models that failed, such as during a backend restart.
    this.failed.clear();
    this.index = new SnapshotIndex(scene);
    this.applyTerrain(scene.terrain);
    this.applyGenerated(scene.generated);
    this.refresh();
    const generation = this.generation;
    void this.settled().then(() => {
      if (generation === this.generation) this.assets.retain(this.referencedUrls());
    });
  }

  /** Resolves when every asset requested for the latest snapshot has loaded or failed. */
  async settled(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Assets of the current snapshot that are ready, failed counting as done. */
  progress(): { loaded: number; total: number } {
    const urls = this.snapshotUrls();
    let loaded = 0;
    for (const url of urls) if (this.assets.get(url) || this.failed.has(url)) loaded++;
    return { loaded, total: urls.size };
  }

  /** Single out one violation: its flag grows and the objects it names get a thick red outline. */
  focusViolation(id: string | undefined): void {
    this.focusedViolation = id;
    const index = this.index;
    if (!index) return;
    const focused = this.focused(index);
    this.violationMarks.focus(this.shownViolations(index), focused?.id);
    this.setOutlines('focus', focused?.refs ?? []);
  }

  setShowViolations(show: boolean): void {
    if (show === this.showViolations) return;
    this.showViolations = show;
    this.refresh();
  }

  /** Point the sun at a region; the shadow camera covers `radius` around `center`. */
  fitShadow(center: Vector3, radius: number): void {
    const sun = this.scene?.map.sun ?? { azimuth: 135, elevation: 45 };
    const direction = sunDirection(sun.azimuth, sun.elevation);
    const extent = Math.max(4, radius);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(direction, extent * 2 + 50);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.near = 1;
    camera.far = extent * 4 + 100;
    camera.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }

  /** The nearest structure module, generated mesh or marker under the ray. */
  pick(raycaster: Raycaster): PickHit | undefined {
    const objects: Object3D[] = [
      ...this.modules.group.children,
      ...this.generatedGroup.children,
      ...this.markers.pickables(),
    ];
    let volume: PickHit | undefined;
    for (const hit of raycaster.intersectObjects(objects, false)) {
      const object = hit.object;
      const ref =
        this.modules.refAt(object, hit.instanceId) ??
        (object.userData.ref as ObjectRef | undefined);
      if (!ref) continue;
      const result = { ref, point: hit.point, distance: hit.distance };
      // Trigger volumes often enclose other objects; those win when both are hit.
      if (object.userData.volume) volume ??= result;
      else return result;
    }
    return volume;
  }

  /** Where the ray meets the terrain, or the y=0 plane on maps without terrain. */
  groundPoint(raycaster: Raycaster): Vector3 | undefined {
    const hit = raycaster.intersectObjects(this.terrainGroup.children, false)[0];
    if (hit) return hit.point.clone();
    return (
      raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3()) ?? undefined
    );
  }

  /** The loaded model of a module type, if any. */
  moduleAsset(typeId: string): Asset | undefined {
    const type = this.index?.moduleTypes.get(typeId);
    return type ? this.assets.get(type.url) : undefined;
  }

  /** Declared size of a module type; unknown types are drawn as 1 m cubes. */
  moduleSize(typeId: string): readonly number[] {
    return this.index?.moduleTypes.get(typeId)?.size ?? [1, 1, 1];
  }

  /**
   * The frame an object moves by: a structure's transform, or a marker's
   * position and rotation. Undefined for modules, which move with their structure.
   */
  frameOf(ref: ObjectRef): Matrix4 | undefined {
    const structure = this.index?.structures.get(ref);
    if (structure) return new Matrix4().fromArray(structure.transform);
    const shape = this.index?.markers.get(ref)?.shape;
    if (!shape) return undefined;
    return new Matrix4()
      .makeRotationY((shape.rotation * Math.PI) / 180)
      .setPosition(...markerPosition(shape));
  }

  /** Terrain height at a map position, if terrain is drawn there. */
  heightAt(x: number, z: number): number | undefined {
    const down = new Raycaster(new Vector3(x, 1e4, z), new Vector3(0, -1, 0));
    return down.intersectObjects(this.terrainGroup.children, false)[0]?.point.y;
  }

  /** Oriented boxes outlining an object: one box for a structure, module or marker. */
  boxesFor(ref: ObjectRef): OrientedBox[] {
    const index = this.index;
    if (!index) return [];
    const structure = index.structures.get(ref);
    if (structure) return this.structureBox(structure.transform, structure.instances);
    // A structure attached to another one: its own modules, in the merged grid.
    if (index.isAttached(ref)) {
      const root = index.structureOf(ref)!;
      const instances = index.instancesOf(ref).map((member) => index.instances.get(member)!);
      return this.structureBox(root.transform, instances);
    }
    const instance = index.instances.get(ref);
    if (instance)
      return [
        {
          matrix: new Matrix4().fromArray(instance.transform),
          min: new Vector3(),
          max: this.sizeOf(instance),
        },
      ];
    const shape = index.markers.get(ref)?.shape;
    const matrix = this.frameOf(ref);
    if (!shape || !matrix) return [];
    if (shape.kind === 'point')
      return [{ matrix, min: new Vector3(-0.7, 0, -0.7), max: new Vector3(0.7, 2.3, 0.7) }];
    const half = new Vector3(...shape.size).multiplyScalar(0.5);
    return [{ matrix, min: half.clone().negate(), max: half }];
  }

  /** One box around some modules, aligned with the structure grid they share. */
  private structureBox(
    transform: readonly number[],
    instances: readonly InstanceView[],
  ): OrientedBox[] {
    if (!instances.length) return [];
    const frame = new Matrix4().fromArray(transform);
    const toLocal = frame.clone().invert();
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const corner = new Vector3();
    for (const instance of instances) {
      const size = this.sizeOf(instance);
      scratch.fromArray(instance.transform).premultiply(toLocal);
      for (let i = 0; i < 8; i++) {
        corner
          .set(i & 1 ? size.x : 0, i & 2 ? size.y : 0, i & 4 ? size.z : 0)
          .applyMatrix4(scratch);
        min.min(corner);
        max.max(corner);
      }
    }
    return [{ matrix: frame, min, max }];
  }

  /** Map-space bounds of an object, for focusing the camera. */
  boundsOf(ref: ObjectRef): Box3 | undefined {
    const boxes = this.boxesFor(ref);
    if (!boxes.length) return undefined;
    const bounds = new Box3();
    for (const box of boxes) bounds.union(new Box3(box.min, box.max).applyMatrix4(box.matrix));
    return bounds;
  }

  /** Sprites that keep a constant on-screen size. */
  screenSprites(): Object3D[] {
    return [...this.violationMarks.flags.children, ...this.markers.icons()];
  }

  private sizeOf(instance: InstanceView): Vector3 {
    const size = this.index?.moduleTypes.get(instance.moduleType)?.size;
    return size ? new Vector3(...size) : new Vector3(1, 1, 1);
  }

  private clear(): void {
    for (const { meshes } of this.terrain.values()) this.terrainGroup.remove(...meshes);
    this.terrain.clear();
    this.modules.clear();
    for (const meshes of this.generated.values()) this.generatedGroup.remove(...meshes);
    this.generated.clear();
    this.markers.clear();
  }

  private track(promise: Promise<unknown>): void {
    const tracked = promise.then(
      () => undefined,
      () => undefined,
    );
    this.pending.add(tracked);
    void tracked.then(() => this.pending.delete(tracked));
  }

  private load(url: string, done: (asset: Asset) => void): void {
    const generation = this.generation;
    this.track(
      this.assets.load(url).then(
        (asset) => {
          this.failed.delete(url);
          if (generation === this.generation) done(asset);
          this.changed();
        },
        (error: unknown) => {
          this.failed.add(url);
          console.warn(`mapedit: could not load ${url}`, error);
          this.changed();
        },
      ),
    );
  }

  /** A module type's model, asking for it when it is neither loaded nor failed. */
  private model(url: string): ModelState {
    if (this.failed.has(url)) return 'failed';
    const asset = this.assets.get(url);
    if (asset) return asset;
    this.loadModuleType(url);
    return 'loading';
  }

  /**
   * Load a module type's model once per URL, then redraw the modules. A type
   * still loading when the next snapshot arrives is not asked for again: each
   * arrival costs one redraw, however many snapshots came in between.
   */
  private loadModuleType(url: string): void {
    if (this.loadingTypes.has(url)) return;
    this.loadingTypes.add(url);
    this.track(
      this.assets
        .load(url)
        .then(
          () => this.failed.delete(url),
          (error: unknown) => {
            this.failed.add(url);
            console.warn(`mapedit: could not load ${url}`, error);
          },
        )
        .then(() => {
          this.loadingTypes.delete(url);
          this.updateModules();
        }),
    );
  }

  private applyTerrain(view: TerrainView): void {
    const keep = new Set<string>();
    for (const chunk of view.chunks) {
      const key = `${chunk.cx},${chunk.cz}`;
      keep.add(key);
      if (this.terrain.get(key)?.url === chunk.url) continue;
      const install = (asset: Asset) => {
        const previous = this.terrain.get(key);
        if (previous) this.terrainGroup.remove(...previous.meshes);
        const meshes = asset.parts.map((part) => {
          const mesh = new Mesh(part.geometry, this.look(this.terrainMaterial(part.material)));
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(part.matrix);
          mesh.receiveShadow = mesh.castShadow = true;
          return mesh;
        });
        if (meshes.length) this.terrainGroup.add(...meshes);
        this.terrain.set(key, { url: chunk.url, meshes });
      };
      const ready = this.assets.get(chunk.url);
      if (ready) install(ready);
      else this.load(chunk.url, install);
    }
    for (const [key, entry] of this.terrain)
      if (!keep.has(key)) {
        if (entry.meshes.length) this.terrainGroup.remove(...entry.meshes);
        this.terrain.delete(key);
      }
  }

  /**
   * Chunks share one material per surface so a large map does not multiply draw
   * state. The shared copy belongs to this view, not to any one chunk's asset.
   */
  private terrainMaterial(material: Material): Material {
    if (!material.name) return material;
    let shared = this.terrainMaterials.get(material.name);
    if (!shared) {
      shared = material.clone();
      this.terrainMaterials.set(material.name, shared);
    }
    return shared;
  }

  /** The material a loaded part is drawn with in the current style. */
  private look(material: Material): Material {
    return this.style === 'toon' ? toonMaterial(material) : material;
  }

  private applyGenerated(views: readonly GeneratedMeshView[]): void {
    const keep = new Set<string>();
    for (const view of views) {
      const key = `${view.owner}\n${view.url}`;
      keep.add(key);
      if (this.generated.has(key)) continue;
      const install = (asset: Asset) => {
        if (this.generated.has(key)) return;
        const meshes = asset.parts.map((part) => {
          const mesh = new Mesh(part.geometry, this.look(part.material));
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(part.matrix);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.ref = view.owner;
          return mesh;
        });
        if (meshes.length) this.generatedGroup.add(...meshes);
        this.generated.set(key, meshes);
      };
      const ready = this.assets.get(view.url);
      if (ready) install(ready);
      else this.load(view.url, install);
    }
    for (const [key, meshes] of this.generated)
      if (!keep.has(key)) {
        if (meshes.length) this.generatedGroup.remove(...meshes);
        this.generated.delete(key);
      }
  }

  /** Redraw everything that follows the snapshot: modules, markers, violation marks, outlines. */
  private refresh(): void {
    const index = this.index;
    if (!index) return;
    const violating = this.violating(index);
    this.modules.update(index, violating, (url) => this.model(url));
    this.markers.update(index.scene.markers, violating);
    const focused = this.focused(index);
    // Objects that only estimated overlaps name may be fine: a dashed outline, no red glass.
    const estimated = [
      ...violatingRefs(index, this.shownViolations(index).filter(isEstimated)),
    ].filter((ref) => !violating.has(ref));
    this.violationMarks.update(
      this.shownViolations(index),
      [...violating].flatMap((ref) => this.boxesFor(ref)),
      estimated.flatMap((ref) => this.boxesFor(ref)),
      focused?.id,
    );
    this.outlines.focus.refs = focused?.refs ?? [];
    for (const layer of Object.values(this.outlines))
      layer.lines.setBoxes(layer.refs.flatMap((ref) => this.boxesFor(ref)));
    this.changed();
  }

  /** Redraw the modules alone, when a model has arrived. */
  private updateModules(): void {
    const index = this.index;
    if (!index) return;
    this.modules.update(index, this.violating(index), (url) => this.model(url));
    this.changed();
  }

  private shownViolations(index: SnapshotIndex): readonly ViolationView[] {
    return this.showViolations ? index.scene.violations : [];
  }

  /** Objects drawn in red because a shown violation that is not an estimate names them. */
  private violating(index: SnapshotIndex): Set<ObjectRef> {
    const certain = this.shownViolations(index).filter((violation) => !isEstimated(violation));
    return violatingRefs(index, certain);
  }

  /** The violation singled out in the list, while the snapshot still has it. */
  private focused(index: SnapshotIndex): ViolationView | undefined {
    const focused = index.scene.violations.find((v) => v.id === this.focusedViolation);
    if (!focused) this.focusedViolation = undefined;
    return focused;
  }

  /** URLs the current snapshot needs. */
  private snapshotUrls(): Set<string> {
    const urls = new Set<string>();
    const scene = this.scene;
    if (!scene) return urls;
    for (const chunk of scene.terrain.chunks) urls.add(chunk.url);
    for (const view of scene.generated) urls.add(view.url);
    const used = new Set(scene.structures.flatMap((s) => s.instances.map((i) => i.moduleType)));
    for (const type of scene.moduleTypes) if (used.has(type.id)) urls.add(type.url);
    return urls;
  }

  /** URLs drawn now plus those the snapshot needs; everything else may be freed. */
  private referencedUrls(): Set<string> {
    const urls = this.snapshotUrls();
    for (const { url } of this.terrain.values()) urls.add(url);
    for (const key of this.generated.keys()) urls.add(key.slice(key.indexOf('\n') + 1));
    for (const url of this.modules.urls()) urls.add(url);
    return urls;
  }
}
