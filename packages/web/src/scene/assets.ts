import { Box3, Matrix4, Mesh, type BufferGeometry, type Material, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeOutlineGeometry, disposeToonMaterial } from './toon.js';

/** One drawable primitive of a glb, with its matrix relative to the glb root. */
export interface AssetPart {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
}

export interface Asset {
  url: string;
  parts: AssetPart[];
  /** Bounds of all parts in the glb's own coordinates. */
  bounds: Box3;
}

export type Fetcher = (url: string) => Promise<ArrayBuffer>;

const defaultFetch: Fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.arrayBuffer();
};

/** Parse a binary glTF into flat parts; GLTFLoader gives each primitive its own mesh. */
export async function parseGlb(url: string, data: ArrayBuffer): Promise<Asset> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  gltf.scene.updateMatrixWorld(true);
  const parts: AssetPart[] = [];
  const bounds = new Box3();
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
    parts.push({
      geometry,
      material: object.material as Material,
      matrix: object.matrixWorld.clone(),
    });
  });
  return { url, parts, bounds };
}

/**
 * Asset URLs never change content, so each one is fetched and parsed once and
 * kept while any snapshot still refers to it.
 */
export class AssetCache {
  private readonly entries = new Map<string, Promise<Asset>>();
  private readonly loaded = new Map<string, Asset>();
  constructor(private readonly fetcher: Fetcher = defaultFetch) {}

  load(url: string): Promise<Asset> {
    let entry = this.entries.get(url);
    if (!entry) {
      entry = this.fetcher(url)
        .then((data) => parseGlb(url, data))
        .then((asset) => {
          if (this.entries.get(url) === entry) this.loaded.set(url, asset);
          else disposeAsset(asset);
          return asset;
        });
      // A failed URL may be retried by a later snapshot.
      entry.catch(() => {
        if (this.entries.get(url) === entry) this.entries.delete(url);
      });
      this.entries.set(url, entry);
    }
    return entry;
  }

  get(url: string): Asset | undefined {
    return this.loaded.get(url);
  }

  /** Free GPU and CPU memory for every asset not in `keep`. */
  retain(keep: ReadonlySet<string>): void {
    for (const url of [...this.entries.keys()]) {
      if (keep.has(url)) continue;
      this.entries.delete(url);
      const asset = this.loaded.get(url);
      this.loaded.delete(url);
      if (asset) disposeAsset(asset);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}

export function disposeAsset(asset: Asset): void {
  const textures = new Set<Texture>();
  for (const part of asset.parts) {
    part.geometry.dispose();
    disposeOutlineGeometry(part.geometry);
    for (const value of Object.values(part.material))
      if (value && typeof value === 'object' && (value as Texture).isTexture)
        textures.add(value as Texture);
    part.material.dispose();
    disposeToonMaterial(part.material);
  }
  for (const texture of textures) texture.dispose();
}
