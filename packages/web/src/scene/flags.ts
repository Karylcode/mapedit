import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';
import type { ViolationView } from '@mapedit/protocol';
import { setScreenSize } from './screen-sprite.js';

const WIDTH = 46;
const HEIGHT = 58;

/** A survey stake with a red pennant carrying the violation's list number. */
function flagTexture(label: string, emphasized: boolean): CanvasTexture {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * scale;
  canvas.height = HEIGHT * scale;
  const g = canvas.getContext('2d')!;
  g.scale(scale, scale);
  g.beginPath();
  g.ellipse(6.5, HEIGHT - 2.5, 5, 2, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(23,32,28,0.35)';
  g.fill();
  g.fillStyle = '#17201c';
  g.fillRect(5, 4, 3, HEIGHT - 6);
  g.beginPath();
  g.moveTo(8, 4);
  g.lineTo(WIDTH - 2, 4);
  g.lineTo(WIDTH - 9, 15);
  g.lineTo(WIDTH - 2, 26);
  g.lineTo(8, 26);
  g.closePath();
  g.fillStyle = emphasized ? '#b3261c' : '#e0412f';
  g.fill();
  g.lineWidth = emphasized ? 2.5 : 1.5;
  g.strokeStyle = emphasized ? '#2b5fd9' : '#f1f3ee';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.font = `700 ${label.length > 2 ? 11 : 14}px Bahnschrift, "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, (8 + WIDTH - 9) / 2, 15.5);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Flags at violation locations, numbered like the violations list. */
export class ViolationFlags extends Group {
  private signature = '';

  /** Returns true when the flags changed. */
  update(violations: readonly ViolationView[], emphasized?: string): boolean {
    const signature = JSON.stringify([violations.map((v) => [v.id, v.location]), emphasized]);
    if (signature === this.signature) return false;
    this.signature = signature;
    this.clear();
    violations.forEach((violation, i) => {
      if (!violation.location) return;
      const strong = violation.id === emphasized;
      const sprite = new Sprite(
        new SpriteMaterial({
          map: flagTexture(String(i + 1), strong),
          depthTest: false,
          sizeAttenuation: false,
        }),
      );
      sprite.center.set(6.5 / WIDTH, 0);
      sprite.position.set(...violation.location);
      sprite.userData.violation = violation.id;
      sprite.renderOrder = strong ? 21 : 20;
      setScreenSize(sprite, WIDTH * (strong ? 1.2 : 1), HEIGHT * (strong ? 1.2 : 1));
      this.add(sprite);
    });
    return true;
  }

  override clear(): this {
    for (const child of this.children) {
      const material = (child as Sprite).material;
      material.map?.dispose();
      material.dispose();
    }
    return super.clear();
  }
}
