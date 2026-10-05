/** Wire contract, version 1. Distances are metres; +Y up, +X east, -Z north. */
export * from './object-ref.js';
export * from './violation-params.js';
export type Vec3 = [number, number, number];
export type Mat4 = number[];
export type ObjectRef = string;
/** How surfaces are shaded: 'standard' is smooth lighting, 'toon' is banded cel shading. */
export type RenderStyle = 'standard' | 'toon';
export const RENDER_STYLES = ['standard', 'toon'] as const satisfies readonly RenderStyle[];
export interface SceneSnapshot {
  protocolVersion: 1;
  revision: number;
  map: MapInfo;
  /** The project's render style; absent means 'standard'. */
  style?: RenderStyle;
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
  /** 'module_preview' is the one-Module scene MCP build_module renders through /render. */
  kind?: 'map' | 'module_preview';
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

export function markerPosition(shape: MarkerView['shape']): Vec3 {
  return shape.kind === 'point' ? shape.position : shape.center;
}

/** Every violation kind, in protocol section 3 order. */
export const VIOLATION_KINDS = [
  'overlap',
  'incompatible_socket',
  'unsupported',
  'off_grid',
  'bad_rotation',
  'out_of_bounds',
  'missing_reference',
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];
export interface ViolationView {
  /** Stable for the same violation across revisions, including reordered diagnostics. */
  id: string;
  kind: ViolationKind;
  message: string;
  /**
   * Documented per kind in protocol section 3 (see ViolationParamsByKind and
   * TypedViolationView); file-backed violations also include file and line.
   * Display metadata does not affect id.
   */
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
      failure?: EditFailure;
    }
  | { type: 'editResult'; requestId: number; ok: boolean; reason?: string; failure?: EditFailure }
  | { type: 'history'; entries: HistoryEntry[]; cursor: number }
  | {
      type: 'notice';
      level: 'info' | 'warning' | 'error';
      code: NoticeCode;
      message: string;
      refs?: ObjectRef[];
      /** The map that holds `refs`, for notices about objects on a map. */
      mapId?: string;
    };
/** Why a previewEdit, applyEdit, undo or redo did not succeed (protocol section 4). */
export const EDIT_FAILURES = [
  'violations',
  'unknown_object',
  'immovable_object',
  'file_errors',
  'nothing_to_undo',
  'nothing_to_redo',
  'internal_error',
] as const;
export type EditFailure = (typeof EDIT_FAILURES)[number];
/** What a history entry did, in protocol section 4 order. */
export const HISTORY_ACTIONS = ['move', 'delete', 'agent_change'] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export interface HistoryEntry {
  id: number;
  author: 'human' | 'agent';
  time: string;
  summary: string;
  files: string[];
  action?: HistoryAction;
  /** The moved or deleted object, or the objects an Agent change affected on all maps. */
  refs?: ObjectRef[];
  /** The map of a human move or delete. */
  mapId?: string;
  /** The objects an Agent change affected, by map. */
  maps?: MapRefs[];
}
/** Objects on one map. */
export interface MapRefs {
  mapId: string;
  refs: ObjectRef[];
}
/** Every notice code, in protocol section 4 order. */
export const NOTICE_CODES = [
  'agent_changed',
  'overwritten_by_agent',
  'agent_change_overridden',
  'edit_rejected',
  'file_error',
  'unknown_map',
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];
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
