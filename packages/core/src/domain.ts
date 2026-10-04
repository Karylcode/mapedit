import type { Document } from 'yaml';
import type {
  FileErrorView,
  MapInfo,
  MarkerView,
  Mat4,
  ProjectInfo,
  SceneSnapshot,
  Vec3,
} from '@mapedit/protocol';

export interface SourceRef {
  file: string;
  line: number;
  path: (string | number)[];
}
export type SocketDirection = 'north' | 'east' | 'south' | 'west' | 'up' | 'down';
export interface Socket {
  id: string;
  type: string;
  position: Vec3;
  rotation: number;
  direction: SocketDirection;
  source: SourceRef;
}
export interface SocketType {
  compatibleWith: string[];
}
export interface ModuleDefinition {
  id: string;
  name: string;
  size: Vec3;
  sockets: Socket[];
  isFoundation: boolean;
  canFloat: boolean;
  terrainFollow: boolean;
  foundationStyle: 'skirt' | 'pillars';
  material?: string;
  source: SourceRef;
}
export interface Attachment {
  socket: string;
  to: string;
}
export interface ModuleInstance {
  id: string;
  module: string;
  at?: Vec3;
  rotation: number;
  attach?: Attachment;
  source: SourceRef;
}
export interface Structure {
  id: string;
  name?: string;
  position: [number, number];
  height: number | 'auto';
  rotation: number;
  modules: ModuleInstance[];
  attach?: Attachment;
  source: SourceRef;
}
export interface Marker {
  id: string;
  type: string;
  shape: MarkerView['shape'];
  properties: Record<string, unknown>;
  source: SourceRef;
}
export interface MapDefinition extends MapInfo {
  structures: Structure[];
  markers: Marker[];
  source: SourceRef;
}
export interface Project {
  name: string;
  socketTypes: Record<string, SocketType>;
  markerTypes: Record<string, { shape: 'point' | 'box' }>;
  materials: string[];
  source: SourceRef;
}
export interface ParsedProject {
  info: ProjectInfo;
  project: Project;
  modules: Record<string, ModuleDefinition>;
  maps: Record<string, MapDefinition>;
  documents: Map<string, Document>;
  files: Record<string, string>;
  fileErrors: FileErrorView[];
}
export interface Bounds {
  min: Vec3;
  max: Vec3;
}
export interface CompiledInstance {
  ref: string;
  structureId: string;
  moduleType: string;
  transform: Mat4;
  size: Vec3;
  bounds: Bounds;
  definition: ModuleDefinition;
  attachTo?: string;
  source: SourceRef;
}
export interface CompiledSocket {
  ref: string;
  instanceRef: string;
  id: string;
  type: string;
  position: Vec3;
  direction: Vec3;
  occupied: boolean;
}
export interface Compilation {
  scene: SceneSnapshot;
  instances: CompiledInstance[];
  sockets: CompiledSocket[];
  socketConnections: { a: string; b: string }[];
  sourceRefs: Record<string, SourceRef>;
}
export const BUILTIN_MATERIAL_IDS = [
  'wood_planks',
  'dark_wood',
  'stone_brick',
  'plaster',
  'roof_tiles',
  'thatch',
  'grass',
  'dirt',
  'gravel',
  'metal',
  'white',
  'red',
  'blue',
];
export const BUILTIN_SOCKET_TYPES: Record<string, SocketType> = {
  foundation: { compatibleWith: ['foundation', 'wall', 'floor', 'stair'] },
  floor: { compatibleWith: ['foundation', 'floor', 'wall', 'stair'] },
  wall: { compatibleWith: ['foundation', 'floor', 'wall', 'roof'] },
  roof: { compatibleWith: ['wall', 'roof'] },
  stair: { compatibleWith: ['foundation', 'floor', 'stair'] },
};
