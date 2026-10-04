import { isNode, isScalar, LineCounter, parseDocument, type Document } from 'yaml';
import type { Edit, FileErrorView, Vec3 } from '@mapedit/protocol';
import {
  BUILTIN_MATERIAL_IDS,
  BUILTIN_SOCKET_TYPES,
  type Attachment,
  type MapDefinition,
  type Marker,
  type ModuleDefinition,
  type ModuleInstance,
  type ParsedProject,
  type Project,
  type Socket,
  type SocketDirection,
  type SocketType,
  type SourceRef,
  type Structure,
} from './domain.js';
import { normalizeRotation, snap } from './math.js';

type Path = (string | number)[];
type RecordValue = Record<string, unknown>;
class InvalidFormat extends Error {
  constructor(
    message: string,
    readonly path: Path,
  ) {
    super(message);
  }
}
const object = (value: unknown, path: Path): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new InvalidFormat('Expected a mapping. Use key: value fields.', path);
  return value as RecordValue;
};
const string = (value: unknown, path: Path, fallback?: string): string => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value.trim())
    throw new InvalidFormat('Expected a non-empty string.', path);
  return value;
};
const id = (value: unknown, path: Path, fallback?: string): string => {
  const result = string(value, path, fallback);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result))
    throw new InvalidFormat(
      'Use a stable id starting with a letter and containing only letters, digits, _ or -.',
      path,
    );
  return result;
};
const number = (value: unknown, path: Path, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new InvalidFormat('Expected a finite number in meters or degrees.', path);
  return value;
};
const boolean = (value: unknown, path: Path, fallback = false): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new InvalidFormat('Expected true or false.', path);
  return value;
};
const array = (value: unknown, path: Path, fallback?: unknown[]): unknown[] => {
  if (value === undefined && fallback) return fallback;
  if (!Array.isArray(value)) throw new InvalidFormat('Expected a YAML list.', path);
  return value;
};
function vector(value: unknown, path: Path, length = 3): number[] {
  const result = array(value, path);
  if (result.length !== length)
    throw new InvalidFormat(`Expected exactly ${length} coordinates in meters.`, path);
  return result.map((n, i) => number(n, [...path, i]));
}
function dimensions(value: unknown, path: Path): Vec3 {
  const result = vector(value, path) as Vec3;
  if (result.some((n) => n <= 0))
    throw new InvalidFormat('Every dimension must be greater than zero.', path);
  return result;
}
function fields(value: RecordValue, keys: string[], path: Path): void {
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra)
    throw new InvalidFormat(`Unknown field "${extra}". Allowed fields: ${keys.join(', ')}.`, [
      ...path,
      extra,
    ]);
}
function unique<T>(items: T[], getId: (item: T) => string, path: Path): T[] {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const key = getId(item);
    if (seen.has(key))
      throw new InvalidFormat(`Duplicate id "${key}". Give each object a unique stable id.`, [
        ...path,
        index,
        'id',
      ]);
    seen.add(key);
  });
  return items;
}
function attachment(value: unknown, path: Path): Attachment | undefined {
  if (value === undefined) return undefined;
  const input = object(value, path);
  fields(input, ['socket', 'to'], path);
  return {
    socket: string(input.socket, [...path, 'socket']),
    to: string(input.to, [...path, 'to']),
  };
}

/** Parse project-relative YAML text. File access belongs to server adapters. */
export function parseProject(inputFiles: Record<string, string>): ParsedProject {
  const files: Record<string, string> = Object.fromEntries(
    Object.entries(inputFiles)
      .map(([file, text]) => [file.replaceAll('\\', '/').replace(/^\.\//, ''), text])
      .sort(([a], [b]) => a!.localeCompare(b!)),
  );
  const documents = new Map<string, Document>(),
    counters = new Map<string, LineCounter>();
  const fileErrors: FileErrorView[] = [];
  const source = (file: string, path: Path): SourceRef => {
    let current = path;
    let node: unknown = documents.get(file)?.getIn(current, true);
    while (!isNode(node) && current.length) {
      current = current.slice(0, -1);
      node = documents.get(file)?.getIn(current, true);
    }
    return {
      file,
      line: counters.get(file)?.linePos(isNode(node) ? (node.range?.[0] ?? 0) : 0).line ?? 1,
      path,
    };
  };
  const read = <T>(file: string, convert: (value: RecordValue) => T): T | undefined => {
    const text = files[file];
    if (text === undefined) {
      fileErrors.push({
        file,
        line: 1,
        message: 'File is missing. Create this required YAML file.',
      });
      return;
    }
    const lineCounter = new LineCounter();
    counters.set(file, lineCounter);
    const document = parseDocument(text, {
      lineCounter,
      keepSourceTokens: true,
      strict: true,
      uniqueKeys: true,
    });
    documents.set(file, document);
    if (document.errors.length) {
      fileErrors.push(
        ...document.errors.map((error) => ({
          file,
          line: error.linePos?.[0]?.line ?? 1,
          message: `${error.message} Fix the YAML syntax.`,
        })),
      );
      return;
    }
    try {
      return convert(object(document.toJS({ maxAliasCount: 100 }), []));
    } catch (error) {
      fileErrors.push({
        file,
        line: source(file, error instanceof InvalidFormat ? error.path : []).line,
        message: error instanceof Error ? error.message : 'Invalid YAML data.',
      });
      return;
    }
  };
  const projectFile = 'project.yaml';
  const defaultProject: Project = {
    name: 'Untitled project',
    socketTypes: Object.assign(
      Object.create(null) as Record<string, SocketType>,
      structuredClone(BUILTIN_SOCKET_TYPES),
    ),
    markerTypes: Object.assign(Object.create(null) as Project['markerTypes'], {
      spawn: { shape: 'point' },
      trigger: { shape: 'box' },
    }),
    materials: [...BUILTIN_MATERIAL_IDS],
    source: { file: projectFile, line: 1, path: [] },
  };
  const project =
    read(projectFile, (value): Project => {
      fields(value, ['version', 'name', 'socketTypes', 'markerTypes', 'materials'], []);
      if (number(value.version, ['version'], 1) !== 1)
        throw new InvalidFormat('Unsupported format version. Use version: 1.', ['version']);
      const result = {
        ...defaultProject,
        name: string(value.name, ['name']),
        source: source(projectFile, []),
      };
      for (const [key, item] of Object.entries(object(value.socketTypes ?? {}, ['socketTypes']))) {
        id(key, ['socketTypes', key]);
        const definition = object(item, ['socketTypes', key]);
        fields(definition, ['compatibleWith'], ['socketTypes', key]);
        result.socketTypes[key] = {
          compatibleWith: array(definition.compatibleWith, [
            'socketTypes',
            key,
            'compatibleWith',
          ]).map((entry, i) => id(entry, ['socketTypes', key, 'compatibleWith', i])),
        };
      }
      for (const [key, item] of Object.entries(object(value.markerTypes ?? {}, ['markerTypes']))) {
        id(key, ['markerTypes', key]);
        const definition = object(item, ['markerTypes', key]);
        fields(definition, ['shape'], ['markerTypes', key]);
        if (definition.shape !== 'point' && definition.shape !== 'box')
          throw new InvalidFormat('Marker shape must be point or box.', [
            'markerTypes',
            key,
            'shape',
          ]);
        result.markerTypes[key] = { shape: definition.shape };
      }
      result.materials = [
        ...BUILTIN_MATERIAL_IDS,
        ...array(value.materials, ['materials'], []).map((entry, i) => id(entry, ['materials', i])),
      ];
      return result;
    }) ?? defaultProject;
  const modules: Record<string, ModuleDefinition> = Object.create(null) as Record<
    string,
    ModuleDefinition
  >;
  for (const file of Object.keys(files).filter((f) => /^modules\/[^/]+\/module\.ya?ml$/.test(f))) {
    const parsed = read(file, (value): ModuleDefinition => {
      fields(
        value,
        [
          'id',
          'name',
          'size',
          'sockets',
          'isFoundation',
          'canFloat',
          'terrainFollow',
          'foundationStyle',
          'material',
        ],
        [],
      );
      const moduleId = id(value.id, ['id'], file.split('/')[1]);
      if (
        value.foundationStyle !== undefined &&
        value.foundationStyle !== 'skirt' &&
        value.foundationStyle !== 'pillars'
      )
        throw new InvalidFormat('foundationStyle must be skirt or pillars.', ['foundationStyle']);
      const sockets = unique(
        array(value.sockets, ['sockets'], []).map((entry, i): Socket => {
          const path: Path = ['sockets', i],
            item = object(entry, path);
          fields(item, ['id', 'type', 'position', 'rotation', 'direction'], path);
          const direction = string(item.direction, [...path, 'direction'], 'south');
          if (!['north', 'east', 'south', 'west', 'up', 'down'].includes(direction))
            throw new InvalidFormat(
              'Socket direction must be north, east, south, west, up or down.',
              [...path, 'direction'],
            );
          return {
            id: id(item.id, [...path, 'id']),
            type: id(item.type, [...path, 'type']),
            position: vector(item.position, [...path, 'position']) as Vec3,
            rotation: number(item.rotation, [...path, 'rotation'], 0),
            direction: direction as SocketDirection,
            source: source(file, path),
          };
        }),
        (socket) => socket.id,
        ['sockets'],
      );
      return {
        id: moduleId,
        name: string(value.name, ['name'], moduleId),
        size: dimensions(value.size, ['size']),
        sockets,
        isFoundation: boolean(value.isFoundation, ['isFoundation']),
        canFloat: boolean(value.canFloat, ['canFloat']),
        terrainFollow: boolean(value.terrainFollow, ['terrainFollow']),
        foundationStyle: value.foundationStyle ?? 'skirt',
        ...(value.material === undefined ? {} : { material: id(value.material, ['material']) }),
        source: source(file, []),
      };
    });
    if (parsed) {
      if (modules[parsed.id])
        fileErrors.push({
          file,
          line: 1,
          message: `Duplicate module id "${parsed.id}". Use a unique id.`,
        });
      else modules[parsed.id] = parsed;
    }
  }
  const maps: Record<string, MapDefinition> = Object.create(null) as Record<string, MapDefinition>;
  for (const file of Object.keys(files).filter((f) => /^maps\/[^/]+\/map\.ya?ml$/.test(f))) {
    const map = read(file, (value): MapDefinition => {
      fields(value, ['id', 'name', 'size', 'sun'], []);
      const mapId = id(value.id, ['id'], file.split('/')[1]),
        size = object(value.size, ['size']);
      fields(size, ['x', 'z'], ['size']);
      const x = number(size.x, ['size', 'x']),
        z = number(size.z, ['size', 'z']);
      if (![x, z].every((n) => Number.isInteger(n) && n >= 100 && n <= 1000))
        throw new InvalidFormat('Map x and z sizes must be whole meters from 100 through 1000.', [
          'size',
        ]);
      const sun = object(value.sun ?? {}, ['sun']);
      fields(sun, ['azimuth', 'elevation'], ['sun']);
      return {
        id: mapId,
        name: string(value.name, ['name'], mapId),
        size: { x, z },
        sun: {
          azimuth: number(sun.azimuth, ['sun', 'azimuth'], 135),
          elevation: number(sun.elevation, ['sun', 'elevation'], 45),
        },
        structures: [],
        markers: [],
        source: source(file, []),
      };
    });
    if (!map) continue;
    if (maps[map.id]) {
      fileErrors.push({ file, line: 1, message: `Duplicate map id "${map.id}". Use a unique id.` });
      continue;
    }
    maps[map.id] = map;
    const directory = file.slice(0, file.lastIndexOf('/'));
    for (const structureFile of Object.keys(files).filter(
      (f) => f.startsWith(`${directory}/structures/`) && /\.ya?ml$/.test(f),
    )) {
      const structures = read(structureFile, (value) => {
        fields(value, ['structures'], []);
        return unique(
          array(value.structures, ['structures']).map((entry, i): Structure => {
            const path: Path = ['structures', i],
              item = object(entry, path);
            fields(
              item,
              ['id', 'name', 'position', 'height', 'rotation', 'attach', 'modules'],
              path,
            );
            const attach = attachment(item.attach, [...path, 'attach']);
            if (attach && ['position', 'height', 'rotation'].some((key) => item[key] !== undefined))
              throw new InvalidFormat(
                'An attached structure uses attach only; remove position, height and rotation.',
                path,
              );
            const modules = unique(
              array(item.modules, [...path, 'modules']).map((entry, j): ModuleInstance => {
                const modulePath = [...path, 'modules', j],
                  instance = object(entry, modulePath);
                fields(instance, ['id', 'module', 'at', 'rotation', 'attach'], modulePath);
                const attached = attachment(instance.attach, [...modulePath, 'attach']);
                if (attached && (instance.at !== undefined || instance.rotation !== undefined))
                  throw new InvalidFormat(
                    'An attached module uses attach only; remove at and rotation.',
                    modulePath,
                  );
                return {
                  id: id(instance.id, [...modulePath, 'id']),
                  module: id(instance.module, [...modulePath, 'module']),
                  rotation: number(instance.rotation, [...modulePath, 'rotation'], 0),
                  ...(attached
                    ? { attach: attached }
                    : { at: vector(instance.at, [...modulePath, 'at']) as Vec3 }),
                  source: source(structureFile, modulePath),
                };
              }),
              (instance) => instance.id,
              [...path, 'modules'],
            );
            return {
              id: id(item.id, [...path, 'id']),
              ...(item.name === undefined ? {} : { name: string(item.name, [...path, 'name']) }),
              position: attach
                ? [0, 0]
                : (vector(item.position, [...path, 'position'], 2) as [number, number]),
              height:
                item.height === undefined || item.height === 'auto'
                  ? 'auto'
                  : number(item.height, [...path, 'height']),
              rotation: number(item.rotation, [...path, 'rotation'], 0),
              modules,
              ...(attach ? { attach } : {}),
              source: source(structureFile, path),
            };
          }),
          (structure) => structure.id,
          ['structures'],
        );
      });
      if (structures) map.structures.push(...structures);
    }
    const markerFile = `${directory}/markers.yaml`;
    if (files[markerFile] !== undefined) {
      map.markers =
        read(markerFile, (value) => {
          fields(value, ['markers'], []);
          return unique(
            array(value.markers, ['markers'], []).map((entry, i): Marker => {
              const path: Path = ['markers', i],
                item = object(entry, path);
              fields(item, ['id', 'type', 'shape', 'properties'], path);
              const shape = object(item.shape, [...path, 'shape']);
              let parsedShape: Marker['shape'];
              if (shape.kind === 'point') {
                fields(shape, ['kind', 'position', 'rotation'], [...path, 'shape']);
                parsedShape = {
                  kind: 'point',
                  position: vector(shape.position, [...path, 'shape', 'position']) as Vec3,
                  rotation: number(shape.rotation, [...path, 'shape', 'rotation'], 0),
                };
              } else if (shape.kind === 'box') {
                fields(shape, ['kind', 'center', 'size', 'rotation'], [...path, 'shape']);
                parsedShape = {
                  kind: 'box',
                  center: vector(shape.center, [...path, 'shape', 'center']) as Vec3,
                  size: dimensions(shape.size, [...path, 'shape', 'size']),
                  rotation: number(shape.rotation, [...path, 'shape', 'rotation'], 0),
                };
              } else
                throw new InvalidFormat('Marker shape.kind must be point or box.', [
                  ...path,
                  'shape',
                  'kind',
                ]);
              return {
                id: id(item.id, [...path, 'id']),
                type: id(item.type, [...path, 'type']),
                shape: parsedShape,
                properties: object(item.properties ?? {}, [...path, 'properties']),
                source: source(markerFile, path),
              };
            }),
            (marker) => marker.id,
            ['markers'],
          );
        }) ?? [];
    }
    const seen = new Set<string>();
    map.structures = map.structures.filter((structure) => {
      if (seen.has(structure.id)) {
        fileErrors.push({
          file: structure.source.file,
          line: structure.source.line,
          message: `Duplicate structure id "${structure.id}" across files. Use a unique id.`,
        });
        return false;
      }
      seen.add(structure.id);
      return true;
    });
  }
  if (Object.keys(maps).length === 0 && !fileErrors.length)
    fileErrors.push({
      file: 'maps',
      line: 1,
      message: 'No maps found. Create maps/<id>/map.yaml.',
    });
  return {
    info: { name: project.name, maps: Object.values(maps).map(({ id, name }) => ({ id, name })) },
    project,
    modules,
    maps,
    documents,
    files,
    fileErrors,
  };
}

/** Snap a human move to the map grid. Explicit structure heights remain explicit. */
export function normalizeEdit(
  parsed: ParsedProject,
  mapId: string,
  edit: Edit,
  terrainHeight: (x: number, z: number) => number = () => 0,
): Edit {
  if (edit.kind === 'delete') return edit;
  const structure = parsed.maps[mapId]?.structures.find((s) => edit.ref === `structure:${s.id}`);
  const x = snap(edit.position[0]),
    z = snap(edit.position[2]);
  const y = structure && structure.height !== 'auto' ? structure.height : snap(terrainHeight(x, z));
  return { ...edit, position: [x, y, z], rotation: normalizeRotation(snap(edit.rotation, 15)) };
}

/** Return only changed source texts, without mutating the parsed project. */
export function applySourceEdit(
  parsed: ParsedProject,
  mapId: string,
  edit: Edit,
): Record<string, string> {
  const map = parsed.maps[mapId];
  if (!map) throw new Error(`Unknown map "${mapId}".`);
  const structure = map.structures.find((s) => `structure:${s.id}` === edit.ref);
  const marker = map.markers.find((m) => `marker:${m.id}` === edit.ref);
  const instance = map.structures
    .flatMap((s) => s.modules.map((m) => ({ ...m, ref: `module:${s.id}/${m.id}` })))
    .find((m) => m.ref === edit.ref);
  const target = structure ?? marker ?? instance;
  if (!target) throw new Error(`Unknown object "${edit.ref}".`);
  const source = target.source,
    document = parsed.documents.get(source.file)?.clone();
  if (!document) throw new Error(`Missing YAML document "${source.file}".`);
  if (edit.kind === 'delete') {
    const removals: SourceRef[] = [source];
    if (structure) {
      const ids = new Set([structure.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const s of map.structures) {
          if (s.attach && ids.has(s.attach.to.split('/')[0]!) && !ids.has(s.id)) {
            ids.add(s.id);
            removals.push(s.source);
            changed = true;
          }
        }
      }
    }
    const changed: Record<string, string> = {};
    for (const file of [...new Set(removals.map((s) => s.file))]) {
      const doc = parsed.documents.get(file)!.clone();
      for (const item of removals
        .filter((s) => s.file === file)
        .sort((a, b) => Number(b.path.at(-1)) - Number(a.path.at(-1))))
        doc.deleteIn(item.path);
      changed[file] = retainNewlines(parsed.files[file]!, String(doc));
    }
    return changed;
  }
  if (instance)
    throw new Error('Move a whole structure; individual module moves are not supported.');
  if (structure?.attach) throw new Error('Move the root of the merged structure.');
  const updates: { path: Path; value: number }[] = [];
  if (structure) {
    updates.push(
      { path: [...source.path, 'position', 0], value: edit.position[0] },
      { path: [...source.path, 'position', 1], value: edit.position[2] },
      { path: [...source.path, 'rotation'], value: edit.rotation },
    );
    if (structure.height !== 'auto')
      updates.push({ path: [...source.path, 'height'], value: edit.position[1] });
  } else if (marker) {
    const coordinate = marker.shape.kind === 'point' ? 'position' : 'center';
    edit.position.forEach((value, i) =>
      updates.push({ path: [...source.path, 'shape', coordinate, i], value }),
    );
    updates.push({ path: [...source.path, 'shape', 'rotation'], value: edit.rotation });
  }
  const replacements: { start: number; end: number; value: string }[] = [];
  let canPatch = true;
  for (const { path, value } of updates) {
    const node = document.getIn(path, true);
    if (isScalar(node) && node.range)
      replacements.push({ start: node.range[0], end: node.range[1], value: String(value) });
    else canPatch = false;
    document.setIn(path, value);
  }
  let output = parsed.files[source.file]!;
  if (canPatch)
    for (const replacement of replacements.sort((a, b) => b.start - a.start))
      output =
        output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  else output = retainNewlines(output, String(document));
  return { [source.file]: output };
}
const retainNewlines = (original: string, output: string): string =>
  original.includes('\r\n') ? output.replace(/\r?\n/g, '\r\n') : output;
