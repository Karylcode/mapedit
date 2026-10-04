import {
  BoxGeometry,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Raycaster,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import type {
  GeneratedMeshView,
  InstanceView,
  ObjectRef,
  SceneSnapshot,
  TerrainView,
} from '@mapedit/protocol';
import type { Asset, AssetCache } from './assets.js';
import { SnapshotIndex, violatingRefs } from './snapshot-index.js';
import { buildMarker, type MarkerObject } from './markers.js';
import { ViolationFlags } from './flags.js';
import { palette } from './palette.js';
import { sunDirection } from './sun.js';
import { BoxOutlines, GlassBoxes, type OrientedBox } from './outline.js';

export type OutlineLayer = 'selection' | 'hover' | 'focus' | 'flash';

export interface PickHit {
  ref: ObjectRef;
  point: Vector3;
  distance: number;
}

interface ModuleBatch {
  /** The asset the meshes were built from; undefined for placeholder boxes. */
  asset?: Asset;
  meshes: InstancedMesh[];
  capacity: number;
  refs: ObjectRef[];
}

const WHITE = new Color(1, 1, 1);
const VIOLATION_TINT = new Color(1, 0.5, 0.45);
const scratch = new Matrix4();

/**
 * Everything drawn for one map snapshot. A new snapshot only reloads what
 * changed: terrain chunks and generated meshes by URL, module types by URL;
 * instance matrices, markers and violation marks are cheap and recomputed.
 */
export class MapView {
  readonly root = new Group();
  readonly sun = new DirectionalLight(palette.sun, 2.3);
  readonly hemisphere = new HemisphereLight(palette.skyLight, palette.groundLight, 2.4);
  readonly flags = new ViolationFlags();
  /** Red glass and outlines around objects in violation, like an invalid placement. */
  readonly violationGlass = new GlassBoxes(palette.flag, 0.3);
  readonly violationLines = new BoxOutlines(palette.flag, 2, { xray: false });
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
  private readonly moduleGroup = new Group();
  private readonly generatedGroup = new Group();
  private readonly markerGroup = new Group();
  private readonly terrain = new Map<string, { url: string; meshes: Mesh[] }>();
  private readonly terrainMaterials = new Map<string, Material>();
  private readonly batches = new Map<string, ModuleBatch>();
  private readonly generated = new Map<string, Mesh[]>();
  private readonly markers = new Map<ObjectRef, MarkerObject>();
  private markerSignature = '';
  private readonly failed = new Set<string>();
  /** Module type URLs with a load in flight; each gets one callback. */
  private readonly loadingTypes = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private focusedViolation?: string;
  private generation = 0;
  private mapId?: string;
  private readonly changeListeners = new Set<() => void>();

  constructor(private readonly assets: AssetCache) {
    this.root.name = 'map';
    this.terrainGroup.name = 'terrain';
    this.moduleGroup.name = 'modules';
    this.generatedGroup.name = 'generated';
    this.markerGroup.name = 'markers';
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.root.add(
      this.hemisphere,
      this.sun,
      this.sun.target,
      this.terrainGroup,
      this.moduleGroup,
      this.generatedGroup,
      this.markerGroup,
      this.flags,
      this.violationGlass,
      this.violationLines,
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
    this.violationLines.setResolution(width, height);
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
    if (scene.map.id !== this.mapId) this.clear();
    this.mapId = scene.map.id;
    this.generation++;
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
    this.refresh();
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
    const objects: Object3D[] = [...this.moduleGroup.children, ...this.generatedGroup.children];
    for (const marker of this.markers.values()) objects.push(...marker.pickables);
    let volume: PickHit | undefined;
    for (const hit of raycaster.intersectObjects(objects, false)) {
      const object = hit.object;
      let ref: ObjectRef | undefined = object.userData.ref as ObjectRef | undefined;
      const batch = object.userData.batch as ModuleBatch | undefined;
      if (batch && hit.instanceId !== undefined) ref = batch.refs[hit.instanceId];
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
    const marker = this.index?.markers.get(ref);
    if (!marker) return undefined;
    const shape = marker.shape;
    return new Matrix4()
      .makeRotationY((shape.rotation * Math.PI) / 180)
      .setPosition(...(shape.kind === 'point' ? shape.position : shape.center));
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
    if (structure) {
      const frame = new Matrix4().fromArray(structure.transform);
      const toLocal = frame.clone().invert();
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      const corner = new Vector3();
      for (const instance of structure.instances) {
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
      return structure.instances.length ? [{ matrix: frame, min, max }] : [];
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
    return [...this.flags.children, ...[...this.markers.values()].map((m) => m.icon)];
  }

  dispose(): void {
    this.clear();
    this.flags.clear();
    for (const material of this.terrainMaterials.values()) material.dispose();
    this.terrainMaterials.clear();
  }

  private sizeOf(instance: InstanceView): Vector3 {
    const size = this.index?.moduleTypes.get(instance.moduleType)?.size;
    return size ? new Vector3(...size) : new Vector3(1, 1, 1);
  }

  private clear(): void {
    for (const { meshes } of this.terrain.values()) this.terrainGroup.remove(...meshes);
    this.terrain.clear();
    for (const batch of this.batches.values()) this.removeBatch(batch);
    this.batches.clear();
    for (const meshes of this.generated.values()) this.generatedGroup.remove(...meshes);
    this.generated.clear();
    for (const marker of this.markers.values()) marker.dispose();
    this.markers.clear();
    this.markerGroup.clear();
    this.markerSignature = '';
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

  /**
   * Load a module type's model once per URL, then redraw. A type still loading
   * when the next snapshot arrives is not asked for again: each arrival costs
   * one refresh, however many snapshots came in between.
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
          this.refresh();
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
          const mesh = new Mesh(part.geometry, this.terrainMaterial(part.material));
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

  private applyGenerated(views: readonly GeneratedMeshView[]): void {
    const keep = new Set<string>();
    for (const view of views) {
      const key = `${view.owner}\n${view.url}`;
      keep.add(key);
      if (this.generated.has(key)) continue;
      const install = (asset: Asset) => {
        if (this.generated.has(key)) return;
        const meshes = asset.parts.map((part) => {
          const mesh = new Mesh(part.geometry, part.material);
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

  /** Recompute instance matrices, tints, markers and flags from the current snapshot. */
  private refresh(): void {
    const index = this.index;
    if (!index) return;
    const scene = index.scene;
    const violating: Set<ObjectRef> = this.showViolations
      ? violatingRefs(index, scene.violations)
      : new Set();
    const tint = (ref: ObjectRef): Color => (violating.has(ref) ? VIOLATION_TINT : WHITE);

    const byType = new Map<string, InstanceView[]>();
    for (const structure of scene.structures)
      for (const instance of structure.instances) {
        const list = byType.get(instance.moduleType) ?? [];
        list.push(instance);
        byType.set(instance.moduleType, list);
      }
    for (const [typeId, batch] of this.batches)
      if (!byType.has(typeId)) {
        this.removeBatch(batch);
        this.batches.delete(typeId);
      }
    for (const [typeId, instances] of byType) {
      const type = index.moduleTypes.get(typeId);
      let asset: Asset | undefined;
      if (type && !this.failed.has(type.url)) {
        asset = this.assets.get(type.url);
        if (!asset) {
          this.loadModuleType(type.url);
          // Keep drawing the previous model of this type until the new one arrives.
          asset = this.batches.get(typeId)?.asset;
          if (!asset) {
            const previous = this.batches.get(typeId);
            if (previous) this.removeBatch(previous);
            this.batches.delete(typeId);
            continue;
          }
        }
      }
      const batch = this.batchFor(typeId, asset, instances.length, type?.size);
      batch.refs = instances.map((instance) => instance.ref);
      instances.forEach((instance, i) => {
        const transform = scratch.fromArray(instance.transform);
        batch.meshes.forEach((mesh, part) => {
          const local = asset?.parts[part]?.matrix;
          mesh.setMatrixAt(i, local ? transform.clone().multiply(local) : transform);
          mesh.setColorAt(i, tint(instance.ref));
        });
      });
      for (const mesh of batch.meshes) {
        mesh.count = instances.length;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
      }
    }

    const markerSignature = JSON.stringify([scene.markers, [...violating].sort()]);
    if (markerSignature !== this.markerSignature) {
      this.markerSignature = markerSignature;
      for (const marker of this.markers.values()) marker.dispose();
      this.markers.clear();
      this.markerGroup.clear();
      for (const view of scene.markers) {
        const marker = buildMarker(view, violating.has(view.ref));
        if (marker.isVolume) for (const mesh of marker.pickables) mesh.userData.volume = true;
        this.markers.set(view.ref, marker);
        this.markerGroup.add(marker.root);
      }
    }
    const focused = scene.violations.find((v) => v.id === this.focusedViolation);
    if (!focused) this.focusedViolation = undefined;
    this.flags.update(this.showViolations ? scene.violations : [], this.focusedViolation);
    const violationBoxes = [...violating].flatMap((ref) => this.boxesFor(ref));
    this.violationGlass.setBoxes(violationBoxes);
    this.violationLines.setBoxes(violationBoxes);
    this.outlines.focus.refs = focused?.refs ?? [];
    for (const layer of Object.values(this.outlines))
      layer.lines.setBoxes(layer.refs.flatMap((ref) => this.boxesFor(ref)));
    this.changed();
  }

  private batchFor(
    typeId: string,
    asset: Asset | undefined,
    count: number,
    size: readonly number[] | undefined,
  ): ModuleBatch {
    const existing = this.batches.get(typeId);
    if (existing && existing.asset === asset && existing.capacity >= count) return existing;
    if (existing) this.removeBatch(existing);
    // A new model for the same instances keeps the buffer; only more instances grow it.
    const capacity =
      existing && count <= existing.capacity
        ? existing.capacity
        : Math.max(count, existing ? existing.capacity * 2 : 0, 1);
    const batch: ModuleBatch = { asset, meshes: [], capacity, refs: [] };
    const parts = asset
      ? asset.parts.map((part) => ({ geometry: part.geometry, material: part.material }))
      : [placeholderPart(size)];
    for (const part of parts) {
      const mesh = new InstancedMesh(part.geometry, part.material, capacity);
      mesh.name = typeId;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.batch = batch;
      mesh.userData.placeholder = !asset;
      batch.meshes.push(mesh);
      this.moduleGroup.add(mesh);
    }
    this.batches.set(typeId, batch);
    return batch;
  }

  private removeBatch(batch: ModuleBatch): void {
    for (const mesh of batch.meshes) {
      this.moduleGroup.remove(mesh);
      mesh.dispose();
      if (mesh.userData.placeholder) {
        mesh.geometry.dispose();
        (mesh.material as Material).dispose();
      }
    }
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
    for (const batch of this.batches.values()) if (batch.asset) urls.add(batch.asset.url);
    return urls;
  }
}

/** A see-through red box for modules whose type is missing or failed to load. */
function placeholderPart(size: readonly number[] | undefined) {
  const [x, y, z] = size && size.length === 3 ? size : [1, 1, 1];
  const geometry = new BoxGeometry(x, y, z).translate(x! / 2, y! / 2, z! / 2);
  const material = new MeshStandardMaterial({
    color: palette.missing,
    transparent: true,
    opacity: 0.55,
    roughness: 0.9,
  });
  return { geometry, material };
}
