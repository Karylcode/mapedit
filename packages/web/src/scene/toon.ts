import {
  BackSide,
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { palette } from './palette.js';

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

/** Ink line width in drawing-buffer pixels. */
const OUTLINE_PIXELS = 2.5;

/** Shared by every outline; the page's MapView keeps it at the drawing buffer size. */
const outlineResolution = { value: new Vector2(1, 1) };

export function setOutlineResolution(width: number, height: number): void {
  outlineResolution.value.set(Math.max(1, width), Math.max(1, height));
}

let ink: MeshBasicMaterial | undefined;

/**
 * The ink of the outlines: an inverted hull. Only the back faces are drawn,
 * each vertex pushed outward on screen along its smoothed normal, so a dark
 * rim of constant width shows around the model and the model hides the rest.
 */
export function outlineMaterial(): Material {
  if (!ink) {
    ink = new MeshBasicMaterial({ color: palette.ink, side: BackSide });
    ink.onBeforeCompile = (shader) => {
      shader.uniforms.outlineResolution = outlineResolution;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec3 outlineNormal;\nuniform vec2 outlineResolution;',
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 outlineDirection = vec4( outlineNormal, 0.0 );
          #ifdef USE_INSTANCING
            outlineDirection = instanceMatrix * outlineDirection;
          #endif
          vec2 outlineOffset = ( projectionMatrix * modelViewMatrix * outlineDirection ).xy;
          if ( dot( outlineOffset, outlineOffset ) > 0.0 )
            gl_Position.xy += normalize( outlineOffset ) * ( ${OUTLINE_PIXELS.toFixed(1)} * 2.0 ) / outlineResolution * gl_Position.w;`,
        );
    };
    ink.customProgramCacheKey = () => 'mapedit-outline';
  }
  return ink;
}

const outlineGeometries = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * The hull of a part: its own positions and triangles, plus normals averaged
 * over every vertex at the same place. Flat-shaded models split their corners
 * into one vertex per face, and pushing those apart would tear gaps in the line.
 */
export function outlineGeometry(geometry: BufferGeometry): BufferGeometry {
  let outline = outlineGeometries.get(geometry);
  if (outline) return outline;
  const position = geometry.getAttribute('position');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    const computed = new BufferGeometry();
    computed.setAttribute('position', position);
    if (geometry.index) computed.setIndex(geometry.index);
    computed.computeVertexNormals();
    normal = computed.getAttribute('normal');
  }
  const key = (i: number) =>
    [position.getX(i), position.getY(i), position.getZ(i)].map((n) => Math.round(n * 1e4)).join();
  const sums = new Map<string, Vector3>();
  for (let i = 0; i < position.count; i++) {
    const sum = sums.get(key(i)) ?? new Vector3();
    sum.x += normal.getX(i);
    sum.y += normal.getY(i);
    sum.z += normal.getZ(i);
    sums.set(key(i), sum);
  }
  const smoothed = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const sum = sums.get(key(i))!;
    if (sum.lengthSq() > 0) sum.normalize();
    smoothed.set([sum.x, sum.y, sum.z], i * 3);
  }
  outline = new BufferGeometry();
  outline.setAttribute('position', position);
  outline.setAttribute('outlineNormal', new Float32BufferAttribute(smoothed, 3));
  if (geometry.index) outline.setIndex(geometry.index);
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  outline.boundingSphere = geometry.boundingSphere!.clone();
  outlineGeometries.set(geometry, outline);
  return outline;
}

/** Free the hull of a geometry that is being disposed together with it. */
export function disposeOutlineGeometry(geometry: BufferGeometry): void {
  outlineGeometries.get(geometry)?.dispose();
  outlineGeometries.delete(geometry);
}
