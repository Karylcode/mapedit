import {
  DataTexture,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  type Material,
} from 'three';

/** Light levels of the bands, from the shadowed side to the lit side. */
const BANDS = [90, 175, 255];

let gradient: DataTexture | undefined;

/** The shared lookup texture that turns smooth lighting into hard bands. */
function toonGradient(): DataTexture {
  if (!gradient) {
    gradient = new DataTexture(new Uint8Array(BANDS), BANDS.length, 1, RedFormat);
    gradient.minFilter = gradient.magFilter = NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCopies = new WeakMap<Material, MeshToonMaterial>();

/**
 * The cel-shaded twin of a glTF material: same color, textures and
 * transparency, lit in bands. Each material gets one twin, made on first use;
 * materials without a base color, such as lines, are returned unchanged.
 */
export function toonMaterial(material: Material): Material {
  if (!(material instanceof MeshStandardMaterial)) return material;
  let toon = toonCopies.get(material);
  if (!toon) {
    toon = new MeshToonMaterial({
      name: material.name,
      color: material.color,
      map: material.map,
      gradientMap: toonGradient(),
      normalMap: material.normalMap,
      normalMapType: material.normalMapType,
      normalScale: material.normalScale,
      aoMap: material.aoMap,
      aoMapIntensity: material.aoMapIntensity,
      emissive: material.emissive,
      emissiveMap: material.emissiveMap,
      emissiveIntensity: material.emissiveIntensity,
      alphaMap: material.alphaMap,
      transparent: material.transparent,
      opacity: material.opacity,
      alphaTest: material.alphaTest,
      side: material.side,
      vertexColors: material.vertexColors,
      depthWrite: material.depthWrite,
    });
    toonCopies.set(material, toon);
  }
  return toon;
}

/** Free the twin of a material that is being disposed; the textures belong to the original. */
export function disposeToonMaterial(material: Material): void {
  toonCopies.get(material)?.dispose();
  toonCopies.delete(material);
}
