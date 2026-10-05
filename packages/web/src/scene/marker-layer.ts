import { Group, type Object3D } from 'three';
import type { MarkerView, ObjectRef } from '@mapedit/protocol';
import { buildMarker, type MarkerObject } from './markers.js';

/** The map's markers. They are rebuilt only when they or their violations change. */
export class MarkerLayer {
  readonly group = new Group();
  private readonly markers = new Map<ObjectRef, MarkerObject>();
  private signature = '';

  constructor() {
    this.group.name = 'markers';
  }

  /** Draw these markers, those in `violating` in flag red. */
  update(views: readonly MarkerView[], violating: ReadonlySet<ObjectRef>): void {
    const red = views.filter((view) => violating.has(view.ref)).map((view) => view.ref);
    const signature = JSON.stringify([views, red]);
    if (signature === this.signature) return;
    this.clear();
    this.signature = signature;
    for (const view of views) {
      const marker = buildMarker(view, violating.has(view.ref));
      if (marker.isVolume) for (const mesh of marker.pickables) mesh.userData.volume = true;
      this.markers.set(view.ref, marker);
      this.group.add(marker.root);
    }
  }

  /** Meshes that select a marker when clicked; each carries its ref. */
  pickables(): Object3D[] {
    return [...this.markers.values()].flatMap((marker) => marker.pickables);
  }

  /** Marker icons, which keep a constant size on screen. */
  icons(): Object3D[] {
    return [...this.markers.values()].map((marker) => marker.icon);
  }

  clear(): void {
    for (const marker of this.markers.values()) marker.dispose();
    this.markers.clear();
    this.group.clear();
    this.signature = '';
  }
}
