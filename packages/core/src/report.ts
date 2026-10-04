import type { ObjectRef, SceneSnapshot, Vec3 } from '@mapedit/protocol';

/** A map with any violation or file error fails check and cannot be exported. */
export function sceneHasProblems(scene: Pick<SceneSnapshot, 'violations' | 'fileErrors'>): boolean {
  return scene.violations.length > 0 || scene.fileErrors.length > 0;
}

export interface FloatingInstance {
  ref: ObjectRef;
  moduleType: string;
  /** Map-space model origin, in meters. */
  position: Vec3;
}

/** Disclose the canFloat exception whether or not the instance currently touches terrain. */
export function listFloatingInstances(scene: SceneSnapshot): FloatingInstance[] {
  const moduleTypes = new Set(
    scene.moduleTypes.filter((module) => module.canFloat).map((module) => module.id),
  );
  return scene.structures.flatMap((structure) =>
    structure.instances
      .filter((instance) => moduleTypes.has(instance.moduleType))
      .map((instance) => ({
        ref: instance.ref,
        moduleType: instance.moduleType,
        position: [
          instance.transform[12]!,
          instance.transform[13]!,
          instance.transform[14]!,
        ] as Vec3,
      })),
  );
}
