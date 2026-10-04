import type { ProjectInfo } from '@mapedit/protocol';
import type { Lang } from '../i18n/i18n.js';
import type { ConnectionStatus } from '../net/connection.js';

export interface EditorState {
  lang: Lang;
  status: ConnectionStatus;
  project?: ProjectInfo;
  /** The map the page shows; set from `?map=` or the first project map. */
  mapId?: string;
  /** Revision of the snapshot currently drawn. */
  revision?: number;
}

/** Prefer the map named in the page address, then the first map of the project. */
export function chooseMap(
  project: ProjectInfo,
  requested: string | null | undefined,
): string | undefined {
  if (requested && project.maps.some((map) => map.id === requested)) return requested;
  return project.maps[0]?.id;
}
