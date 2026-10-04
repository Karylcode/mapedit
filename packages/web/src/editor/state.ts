import type { HistoryEntry, ObjectRef, ProjectInfo, SceneSnapshot } from '@mapedit/protocol';
import type { Lang } from '../i18n/i18n.js';
import type { ConnectionStatus } from '../net/connection.js';

export interface Progress {
  loaded: number;
  total: number;
}

export interface EditorState {
  lang: Lang;
  status: ConnectionStatus;
  project?: ProjectInfo;
  /** The map the page shows; set from `?map=` or the first project map. */
  mapId?: string;
  /** Latest snapshot of the open map. */
  scene?: SceneSnapshot;
  /** Revision of the snapshot currently drawn. */
  revision?: number;
  history: { entries: HistoryEntry[]; cursor: number };
  /** Models of the current snapshot that finished loading. */
  progress: Progress;
  /** True from opening a map until its first snapshot is fully drawn. */
  loadingMap: boolean;
  /** Selected structure, module or marker. */
  selection?: ObjectRef;
  /** Object under the pointer, with the pointer's page position. */
  hover?: { ref: ObjectRef; x: number; y: number };
}

export const initialState = (lang: Lang): EditorState => ({
  lang,
  status: 'connecting',
  history: { entries: [], cursor: 0 },
  progress: { loaded: 0, total: 0 },
  loadingMap: false,
});

/** Prefer the map named in the page address, then the first map of the project. */
export function chooseMap(
  project: ProjectInfo,
  requested: string | null | undefined,
): string | undefined {
  if (requested && project.maps.some((map) => map.id === requested)) return requested;
  return project.maps[0]?.id;
}
