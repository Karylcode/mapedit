import {
  Box3,
  Color,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import type { RenderSpec, RenderWindow, SceneSnapshot } from '@mapedit/protocol';
import { AssetCache } from '../scene/assets.js';
import { MapView } from '../scene/map-view.js';
import { palette } from '../scene/palette.js';
import { fitScreenSprites } from '../scene/screen-sprite.js';
import { montageLayout, regionOf, viewCamera, type Region, type ViewName } from './views.js';
import {
  drawLegend,
  drawNorthArrow,
  drawViewLabel,
  isModulePreview,
  legendLines,
  needsGroundPlane,
} from './montage.js';

const VIEWS: readonly ViewName[] = ['top', 'ne', 'nw', 'se', 'sw'];
/** How long `minRevision` may take to arrive. */
const REVISION_WAIT_MS = 20_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchScene(mapId: string | null): Promise<SceneSnapshot> {
  const query = mapId === null ? '' : `?map=${encodeURIComponent(mapId)}`;
  const response = await fetch(`/api/scene${query}`, { cache: 'no-store' });
  const body = (await response.json()) as SceneSnapshot | { error?: string };
  if (!response.ok)
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  return body as SceneSnapshot;
}

/** Reject malformed specs with a message the Agent can act on. */
function checkSpec(spec: RenderSpec): void {
  if (!spec || !Array.isArray(spec.views) || spec.views.length === 0)
    throw new Error('RenderSpec.views must list at least one of top, ne, nw, se, sw.');
  for (const view of spec.views)
    if (!VIEWS.includes(view)) throw new Error(`Unknown view "${String(view)}".`);
  if (!Number.isInteger(spec.tileSize) || spec.tileSize < 16 || spec.tileSize > 2048)
    throw new Error('RenderSpec.tileSize must be an integer from 16 to 2048 pixels.');
}

/**
 * The screenshot page. It has no interface: it loads the map, sets
 * `mapeditRenderReady`, and draws montages for the backend on request.
 */
class RenderPage {
  private renderer?: WebGLRenderer;
  private failure?: string;
  private readonly scene = new Scene();
  private readonly map = new MapView(new AssetCache());
  private snapshot?: SceneSnapshot;
  private readonly groundPlane = new Scene();
  private queue: Promise<unknown> = Promise.resolve();
  /** Spacing of the grid drawn on the ground plane under a module preview, in meters. */
  private gridStep = 0.5;

  constructor(private readonly mapId: string | null) {
    this.scene.background = new Color(palette.sky);
    this.scene.add(this.map.root, this.groundPlane);
  }

  /** Never throws; a failure is reported by the next `mapeditRender` call instead. */
  async prepare(): Promise<void> {
    try {
      this.renderer = new WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFShadowMap;
      this.renderer.toneMapping = NeutralToneMapping;
    } catch (error) {
      this.failure = `WebGL is not available in this browser: ${message(error)}`;
      return;
    }
    try {
      await this.load(await fetchScene(this.mapId));
    } catch (error) {
      this.failure = `Could not load map "${this.mapId ?? ''}": ${message(error)}`;
    }
  }

  /** Draw one montage at a time; the page has a single WebGL canvas. */
  render(spec: RenderSpec): Promise<string> {
    const run = this.queue.then(() => this.draw(spec));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async load(snapshot: SceneSnapshot): Promise<void> {
    this.snapshot = snapshot;
    this.map.apply(snapshot);
    await this.map.settled();
  }

  private async waitForRevision(minimum: number): Promise<void> {
    const deadline = performance.now() + REVISION_WAIT_MS;
    while ((this.snapshot?.revision ?? -1) < minimum) {
      if (performance.now() > deadline)
        throw new Error(
          `Timed out waiting for map revision ${minimum}; the newest is ${this.snapshot?.revision}.`,
        );
      await delay(100);
      const next = await fetchScene(this.mapId);
      if (next.revision !== this.snapshot?.revision) await this.load(next);
    }
  }

  private async draw(spec: RenderSpec): Promise<string> {
    if (this.failure) throw new Error(this.failure);
    checkSpec(spec);
    await this.waitForRevision(spec.minRevision ?? 0);
    const renderer = this.renderer!;
    const snapshot = this.snapshot!;
    this.map.setShowViolations(spec.showViolations ?? true);
    this.map.setOutlines('selection', spec.highlight ?? []);
    const region = regionOf(spec, this.content(snapshot));
    this.placeGroundPlane(snapshot, region);
    const tile = spec.tileSize;
    renderer.setSize(tile, tile, false);
    this.map.setResolution(tile, tile);
    const { columns, rows } = montageLayout(spec.views.length);
    const canvas = document.createElement('canvas');
    canvas.width = columns * tile;
    canvas.height = rows * tile;
    const g = canvas.getContext('2d')!;
    spec.views.forEach((view, i) => {
      const x = (i % columns) * tile;
      const y = Math.floor(i / columns) * tile;
      const camera = viewCamera(
        view,
        view === 'top' ? this.topRegion(spec, region, snapshot) : region,
      );
      this.map.fitShadow(region.center, region.radius * 1.15);
      fitScreenSprites(this.map.screenSprites(), tile, camera);
      renderer.render(this.scene, camera);
      g.drawImage(renderer.domElement, x, y);
      drawViewLabel(g, x, y, view, tile);
      if (view === 'top') drawNorthArrow(g, x, y, tile);
    });
    for (let i = spec.views.length; i < columns * rows; i++)
      drawLegend(
        g,
        (i % columns) * tile,
        Math.floor(i / columns) * tile,
        tile,
        legendLines(snapshot, this.gridStep),
      );
    g.fillStyle = '#17201c';
    for (let c = 1; c < columns; c++) g.fillRect(c * tile - 1, 0, 2, canvas.height);
    for (let r = 1; r < rows; r++) g.fillRect(0, r * tile - 1, canvas.width, 2);
    return canvas.toDataURL('image/png');
  }

  /** Everything drawn: the map's ground plus its structures and markers. */
  private content(snapshot: SceneSnapshot): Box3 {
    const box = new Box3();
    const terrain = this.map.root.getObjectByName('terrain');
    this.map.root.updateMatrixWorld(true);
    if (terrain?.children.length) {
      box.setFromObject(terrain);
      box.expandByPoint(new Vector3(0, box.min.y, 0));
      box.expandByPoint(new Vector3(snapshot.map.size.x, box.min.y, snapshot.map.size.z));
    }
    for (const ref of [
      ...snapshot.structures.map((s) => s.ref),
      ...snapshot.markers.map((m) => m.ref),
    ]) {
      const bounds = this.map.boundsOf(ref);
      if (bounds) box.union(bounds);
    }
    if (box.isEmpty())
      box.set(new Vector3(0, 0, 0), new Vector3(snapshot.map.size.x, 1, snapshot.map.size.z));
    return box;
  }

  /** The top view of a whole map frames the map's rectangle, not its bounding sphere. */
  private topRegion(spec: RenderSpec, region: Region, snapshot: SceneSnapshot): Region {
    if (spec.focus || isModulePreview(snapshot)) return region;
    const half = Math.max(snapshot.map.size.x, snapshot.map.size.z) / 2;
    return {
      center: new Vector3(snapshot.map.size.x / 2, region.center.y, snapshot.map.size.z / 2),
      radius: half * 1.04,
    };
  }

  /**
   * Scenes without terrain, module previews and maps whose terrain did not
   * load, get a ground plane with a grid, so sizes and shadows can be read.
   */
  private placeGroundPlane(snapshot: SceneSnapshot, region: Region): void {
    for (const child of [...this.groundPlane.children]) {
      this.groundPlane.remove(child);
      const mesh = child as Mesh;
      mesh.geometry?.dispose();
      (mesh.material as Material | undefined)?.dispose();
    }
    if (!needsGroundPlane(snapshot)) return;
    const size = Math.max(4, Math.ceil(region.radius * 4));
    const step = (this.gridStep = size <= 100 ? 0.5 : size <= 400 ? 1 : 5);
    const span = Math.ceil(size / step) * step;
    const x = Math.round(region.center.x / step) * step;
    const z = Math.round(region.center.z / step) * step;
    const plane = new Mesh(
      new PlaneGeometry(span, span).rotateX(-Math.PI / 2),
      new MeshStandardMaterial({ color: 0xd3d9cd, roughness: 1 }),
    );
    plane.position.set(x, -0.002, z);
    plane.receiveShadow = true;
    const grid = new GridHelper(span, Math.round(span / step), 0x8a958e, 0xaab3ad);
    grid.position.set(x, 0, z);
    this.groundPlane.add(plane, grid);
  }
}

export async function start(): Promise<void> {
  const target = window as unknown as RenderWindow;
  target.mapeditRenderReady = false;
  const page = new RenderPage(new URL(location.href).searchParams.get('map'));
  target.mapeditRender = (spec) => page.render(spec);
  await page.prepare();
  target.mapeditRenderReady = true;
}
