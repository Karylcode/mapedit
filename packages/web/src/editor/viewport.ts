import {
  Color,
  Fog,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { MapView } from '../scene/map-view.js';
import { OverviewCamera } from '../scene/overview-camera.js';
import { palette } from '../scene/palette.js';
import { fitScreenSprites } from '../scene/screen-sprite.js';

type FrameTask = (seconds: number) => boolean | void;

/** Device pixels per CSS pixel, capped at 2 to keep large screens fast. */
const pixelRatio = () => Math.min(globalThis.devicePixelRatio || 1, 2);

/** The editor's WebGL view. It renders on demand: only after something changed. */
export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(40, 1, 0.5, 5000);
  readonly scene = new Scene();
  readonly overview = new OverviewCamera();
  readonly size = new Vector2(1, 1);
  private readonly tasks = new Set<FrameTask>();
  private frame?: number;
  private last = 0;

  constructor(
    readonly element: HTMLElement,
    readonly map: MapView,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(pixelRatio());
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    // Keeps material base colors recognizable while softening bright sunlit faces.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.domElement.className = 'viewport-canvas';
    element.append(this.renderer.domElement);
    this.scene.background = new Color(palette.sky);
    this.scene.fog = new Fog(palette.sky, 1000, 4000);
    this.scene.add(map.root);
    map.onChange(() => this.invalidate());
    new ResizeObserver(() => this.resize()).observe(element);
    this.watchPixelRatio();
    this.resize();
  }

  /**
   * A move to a screen with another scale changes the pixel density without
   * resizing anything. Ask for a frame then; each frame checks the density.
   */
  private watchPixelRatio(): void {
    const query = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
    query?.addEventListener(
      'change',
      () => {
        this.invalidate();
        this.watchPixelRatio();
      },
      { once: true },
    );
  }

  /** Run `task` before each frame; it keeps frames coming while it returns true. */
  addTask(task: FrameTask): () => void {
    this.tasks.add(task);
    this.invalidate();
    return () => this.tasks.delete(task);
  }

  invalidate(): void {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame((time) => this.render(time));
  }

  private resize(): void {
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    this.size.set(width, height);
    if (this.renderer.getPixelRatio() !== pixelRatio()) this.renderer.setPixelRatio(pixelRatio());
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const ratio = this.renderer.getPixelRatio();
    this.map.setResolution(width * ratio, height * ratio);
    this.invalidate();
  }

  private render(time: number): void {
    this.frame = undefined;
    // Browser zoom or another screen changed the pixel density: draw sharp at the new one.
    if (this.renderer.getPixelRatio() !== pixelRatio()) this.resize();
    const seconds = this.last ? Math.min(0.1, (time - this.last) / 1000) : 0;
    let animating = false;
    for (const task of [...this.tasks]) if (task(seconds)) animating = true;
    this.last = animating ? time : 0;
    const overview = this.overview;
    overview.apply(this.camera);
    const fog = this.scene.fog as Fog;
    fog.near = overview.distance * 2.2;
    fog.far = overview.distance * 7 + 400;
    this.map.fitShadow(overview.target, Math.min(overview.distance * 1.1, 600));
    fitScreenSprites(this.map.screenSprites(), this.size.y, this.camera);
    this.renderer.render(this.scene, this.camera);
    if (animating) this.invalidate();
  }
}
