/** 3D colors, matching the HUD tokens in editor/styles.css. */
export const palette = {
  sky: 0xc9dbe3,
  skyLight: 0xeef4f8,
  groundLight: 0x9a907c,
  sun: 0xfff3df,
  ink: 0x17201c,
  chalk: 0xf1f3ee,
  /** Selection, hover and snapping. */
  chalkline: 0x2b5fd9,
  /** Violations only. */
  flag: 0xe0412f,
  /** Objects the module type cannot be drawn for. */
  missing: 0xe0412f,
  previewGrid: 0x2b5fd9,
} as const;

/** Marker colors avoid the selection blue, violation red and warning amber. */
const markerColors: Record<string, number> = { spawn: 0x14907f, trigger: 0x7c55e6 };
const extraMarkerColors = [0xc23f97, 0x5f7f12, 0x0f6f8f, 0x9a5b22];

export function markerColor(type: string): number {
  const known = markerColors[type];
  if (known !== undefined) return known;
  let hash = 0;
  for (const char of type) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return extraMarkerColors[hash % extraMarkerColors.length]!;
}
