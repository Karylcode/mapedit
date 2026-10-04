/** Wire contract, version 1. Distances are metres; +Y up, +X east, -Z north. */
export type Vec3 = [number, number, number];
export type Mat4 = number[];
export type ObjectRef = string;
export interface SceneSnapshot {
  protocolVersion: 1;
  revision: number;
  map: MapInfo;
  terrain: TerrainView;
  moduleTypes: ModuleTypeView[];
  structures: StructureView[];
  generated: GeneratedMeshView[];
  markers: MarkerView[];
  violations: ViolationView[];
  fileErrors: FileErrorView[];
}
export interface MapInfo {
  id: string;
  name: string;
  size: { x: number; z: number };
  sun: { azimuth: number; elevation: number };
}
export interface TerrainView {
  revision: number;
  chunks: { cx: number; cz: number; url: string }[];
}
export interface ModuleTypeView {
  id: string;
  name: string;
  url: string;
  size: Vec3;
  isFoundation: boolean;
  canFloat: boolean;
}
export interface StructureView {
  ref: ObjectRef;
  name?: string;
  file: string;
  transform: Mat4;
  instances: InstanceView[];
}
export interface InstanceView {
  ref: ObjectRef;
  moduleType: string;
  transform: Mat4;
}
export interface GeneratedMeshView {
  owner: ObjectRef;
  url: string;
}
export interface MarkerView {
  ref: ObjectRef;
  type: string;
  shape:
    | { kind: 'point'; position: Vec3; rotation: number }
    | { kind: 'box'; center: Vec3; size: Vec3; rotation: number };
  properties: Record<string, unknown>;
}
export type ViolationKind =
  | 'overlap'
  | 'incompatible_socket'
  | 'unsupported'
  | 'off_grid'
  | 'bad_rotation'
  | 'out_of_bounds'
  | 'missing_reference';
export interface ViolationView {
  /** Stable for the same violation across revisions, including reordered diagnostics. */
  id: string;
  kind: ViolationKind;
  message: string;
  /** File-backed violations include file and line; display metadata does not affect id. */
  params: Record<string, unknown>;
  refs: ObjectRef[];
  location?: Vec3;
  suggestion?: string;
}
export interface FileErrorView {
  file: string;
  line?: number;
  message: string;
}
export interface ProjectInfo {
  name: string;
  maps: { id: string; name: string }[];
}
export type Edit =
  | { kind: 'move'; ref: ObjectRef; position: Vec3; rotation: number }
  | { kind: 'delete'; ref: ObjectRef };
export type ClientMessage =
  | { type: 'hello'; protocolVersion: 1; client: 'editor' | 'render' }
  | { type: 'openMap'; mapId: string }
  | { type: 'previewEdit'; requestId: number; edit: Edit }
  | { type: 'applyEdit'; requestId: number; edit: Edit; baseRevision: number }
  | { type: 'undo'; requestId: number }
  | { type: 'redo'; requestId: number };
export type ServerMessage =
  | { type: 'welcome'; protocolVersion: 1; project: ProjectInfo }
  | { type: 'scene'; scene: SceneSnapshot }
  | {
      type: 'previewResult';
      requestId: number;
      ok: boolean;
      transform?: Mat4;
      violations: ViolationView[];
    }
  | { type: 'editResult'; requestId: number; ok: boolean; reason?: string }
  | { type: 'history'; entries: HistoryEntry[]; cursor: number }
  | {
      type: 'notice';
      level: 'info' | 'warning' | 'error';
      code: NoticeCode;
      message: string;
      refs?: ObjectRef[];
    };
export interface HistoryEntry {
  id: number;
  author: 'human' | 'agent';
  time: string;
  summary: string;
  files: string[];
}
export type NoticeCode =
  | 'agent_changed'
  | 'overwritten_by_agent'
  | 'agent_change_overridden'
  | 'edit_rejected'
  | 'file_error';
export interface RenderSpec {
  views: Array<'top' | 'ne' | 'nw' | 'se' | 'sw'>;
  focus?: { center: Vec3; radius: number };
  tileSize: number;
  highlight?: ObjectRef[];
  showViolations?: boolean;
  minRevision?: number;
}
export interface RenderWindow {
  mapeditRenderReady: boolean;
  mapeditRender(spec: RenderSpec): Promise<string>;
}
