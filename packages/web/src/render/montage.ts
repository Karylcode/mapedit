import type { ViewName } from './views.js';

const FONT = 'Bahnschrift, "Segoe UI", system-ui, sans-serif';
const INK = '#17201c';
const CHALK = '#f1f3ee';
const FLAG = '#e0412f';

/** A dark tag in a tile's top-left corner naming the view. */
export function drawViewLabel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  view: ViewName,
  tile: number,
): void {
  const size = Math.max(11, Math.round(tile / 26));
  g.font = `600 ${size}px ${FONT}`;
  const width = g.measureText(view).width + size;
  g.fillStyle = INK;
  g.fillRect(x + size * 0.5, y + size * 0.5, width, size * 1.6);
  g.fillStyle = CHALK;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillText(view, x + size, y + size * 1.3);
}

/** A north arrow in a tile's top-right corner; north is straight up in the top view. */
export function drawNorthArrow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
): void {
  const r = Math.max(12, Math.round(tile / 18));
  const cx = x + tile - r * 1.6;
  const cy = y + r * 1.6;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = CHALK;
  g.fill();
  g.lineWidth = Math.max(1.5, r / 8);
  g.strokeStyle = INK;
  g.stroke();
  g.beginPath();
  g.moveTo(cx, cy - r * 0.78);
  g.lineTo(cx + r * 0.36, cy + r * 0.1);
  g.lineTo(cx - r * 0.36, cy + r * 0.1);
  g.closePath();
  g.fillStyle = FLAG;
  g.fill();
  g.font = `700 ${Math.round(r * 0.7)}px ${FONT}`;
  g.fillStyle = INK;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', cx, cy + r * 0.48);
}

/** Facts for the spare tile of a montage, written for the Agent reading it. */
export function drawLegend(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  tile: number,
  lines: { text: string; alert?: boolean }[],
): void {
  g.fillStyle = INK;
  g.fillRect(x, y, tile, tile);
  const size = Math.max(11, Math.round(tile / 22));
  g.textAlign = 'left';
  g.textBaseline = 'top';
  lines.forEach((line, i) => {
    g.font = `${i === 0 ? 700 : 500} ${i === 0 ? Math.round(size * 1.25) : size}px ${FONT}`;
    g.fillStyle = line.alert ? '#ff8a7a' : CHALK;
    g.fillText(line.text, x + size, y + size + i * size * 1.7, tile - size * 2);
  });
}
