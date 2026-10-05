import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Material,
} from 'three';
import type { MarkerView } from '@mapedit/protocol';
import { markerColor, palette } from './palette.js';
import { setScreenSize } from './screen-sprite.js';

const DEG = Math.PI / 180;

/** A point marker faces local +Z (south) at rotation 0, like Minecraft's yaw 0. */
function facingArrow(): ShapeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.22, 0.25);
  shape.lineTo(0, 0.95);
  shape.lineTo(0.22, 0.25);
  shape.lineTo(-0.22, 0.25);
  const geometry = new ShapeGeometry(shape);
  // Shape space is X/Y; lay it on the ground so +Y becomes +Z.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export interface MarkerObject {
  root: Group;
  /** Meshes that select the marker when clicked. */
  pickables: Mesh[];
  icon: Sprite;
  /** Box volumes are picked only when nothing solid is in front of them. */
  isVolume: boolean;
  dispose(): void;
}

/** Build the visual for one marker in map coordinates. */
export function buildMarker(marker: MarkerView, violating: boolean): MarkerObject {
  const color = new Color(violating ? palette.flag : markerColor(marker.type));
  const root = new Group();
  root.name = marker.ref;
  const materials: Material[] = [];
  const geometries: { dispose(): void }[] = [];
  const track = <T extends Material>(material: T): T => (materials.push(material), material);
  const keep = <T extends { dispose(): void }>(geometry: T): T => (
    geometries.push(geometry),
    geometry
  );
  const pickables: Mesh[] = [];
  const shape = marker.shape;
  if (shape.kind === 'point') {
    root.position.set(...shape.position);
    root.rotation.y = shape.rotation * DEG;
    const flat = track(
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    const solid = track(new MeshStandardMaterial({ color, roughness: 0.6 }));
    const disc = new Mesh(keep(new CircleGeometry(0.62, 40).rotateX(-Math.PI / 2)), flat);
    disc.position.y = 0.03;
    const ring = new Mesh(
      keep(new RingGeometry(0.5, 0.62, 40).rotateX(-Math.PI / 2)),
      track(new MeshBasicMaterial({ color, side: DoubleSide })),
    );
    ring.position.y = 0.04;
    const arrow = new Mesh(
      keep(facingArrow()),
      track(new MeshBasicMaterial({ color, side: DoubleSide })),
    );
    arrow.position.y = 0.05;
    const pole = new Mesh(keep(new CylinderGeometry(0.035, 0.035, 1.7, 8)), solid);
    pole.position.y = 0.85;
    const gem = new Mesh(keep(new OctahedronGeometry(0.22)), solid);
    gem.position.y = 1.95;
    gem.castShadow = pole.castShadow = true;
    root.add(disc, ring, arrow, pole, gem);
    pickables.push(disc, pole, gem);
  } else {
    root.position.set(...shape.center);
    root.rotation.y = shape.rotation * DEG;
    const box = keep(new BoxGeometry(...shape.size));
    const volume = new Mesh(
      box,
      track(
        new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.14,
          depthWrite: false,
          side: DoubleSide,
        }),
      ),
    );
    volume.renderOrder = 2;
    const edges = new LineSegments(
      keep(new EdgesGeometry(box)),
      track(new LineBasicMaterial({ color, transparent: true, opacity: 0.95 })),
    );
    root.add(volume, edges);
    pickables.push(volume);
  }
  const icon = new Sprite(
    track(
      new SpriteMaterial({
        map: iconTexture(marker.type, color),
        depthTest: false,
        sizeAttenuation: false,
      }),
    ),
  );
  icon.center.set(0.5, 0);
  icon.position.y = shape.kind === 'point' ? 2.3 : shape.size[1] / 2 + 0.3;
  icon.renderOrder = 5;
  setScreenSize(icon, 26, 26, { near: 160, min: 0.6 });
  root.add(icon);
  for (const mesh of pickables) mesh.userData.ref = marker.ref;
  return {
    root,
    pickables,
    icon,
    isVolume: shape.kind === 'box',
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        (material as MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    },
  };
}

/** A round badge drawn at runtime: no image files, so it works on the render page too. */
function iconTexture(type: string, color: Color): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = `#${color.getHexString()}`;
  g.strokeStyle = '#f1f3ee';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(32, 32, 27, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = g.strokeStyle = '#f1f3ee';
  g.lineCap = g.lineJoin = 'round';
  if (type === 'spawn') {
    g.beginPath();
    g.arc(32, 21, 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(32, 30);
    g.lineTo(32, 42);
    g.moveTo(23, 50);
    g.lineTo(32, 42);
    g.lineTo(41, 50);
    g.moveTo(22, 33);
    g.lineTo(42, 33);
    g.stroke();
  } else if (type === 'trigger') {
    g.beginPath();
    g.moveTo(36, 12);
    g.lineTo(21, 35);
    g.lineTo(31, 35);
    g.lineTo(27, 52);
    g.lineTo(43, 28);
    g.lineTo(33, 28);
    g.closePath();
    g.fill();
  } else {
    g.font = '700 30px Bahnschrift, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((type[0] ?? '?').toUpperCase(), 32, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
