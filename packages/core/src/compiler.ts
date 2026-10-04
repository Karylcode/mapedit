import type {
  MapEdge,
  Mat4,
  OffGridField,
  RotationField,
  SceneSnapshot,
  TerrainView,
  Vec3,
  ViolationView,
} from '@mapedit/protocol';
import { markerPosition, markerRef, moduleRef, structureRef } from '@mapedit/protocol';
import type {
  Compilation,
  Bounds,
  CompiledInstance,
  CompiledSocket,
  MapDefinition,
  ModuleDefinition,
  ModuleInstance,
  ParsedProject,
  Socket,
  SourceRef,
  Structure,
} from './domain.js';
import {
  clean,
  compareText,
  directionVector,
  EPSILON,
  moduleTransform,
  multiplyMatrices,
  onGrid,
  snap,
  transformBounds,
  transformMatrix,
  transformPoint,
  yawOf,
} from './math.js';
import { createViolation } from './violation.js';
import { socketAttachment, socketTypesCompatible } from './socket-rules.js';
import { createCompilerAdvice } from './compiler-suggestions.js';

/** Map edges the bounds cross, and how far beyond each edge they reach, in metres. */
export function exceededMapEdges(
  bounds: Bounds,
  size: MapDefinition['size'],
): { edge: MapEdge; distance: number }[] {
  const edges: { edge: MapEdge; distance: number }[] = [];
  if (bounds.min[2] < -EPSILON) edges.push({ edge: 'north', distance: clean(-bounds.min[2]) });
  if (bounds.max[2] > size.z + EPSILON)
    edges.push({ edge: 'south', distance: clean(bounds.max[2] - size.z) });
  if (bounds.max[0] > size.x + EPSILON)
    edges.push({ edge: 'east', distance: clean(bounds.max[0] - size.x) });
  if (bounds.min[0] < -EPSILON) edges.push({ edge: 'west', distance: clean(-bounds.min[0]) });
  return edges;
}

export interface CompileOptions {
  revision?: number;
  terrainHeight?: (x: number, z: number) => number;
  moduleUrl?: (moduleId: string) => string;
  terrain?: TerrainView;
}
interface LocalInstance {
  instance: ModuleInstance;
  definition: ModuleDefinition;
  transform: Mat4;
  attachTo?: string;
}
interface StructurePlacement {
  transform: Mat4;
  root: string;
}
interface PlacedSocket {
  socket: Socket;
  transform: Mat4;
  instanceRef: string;
}

/** Pure, deterministic compilation. Geometry checks are added by the geometry stage. */
export function compileMap(
  parsed: ParsedProject,
  mapId = parsed.info.maps[0]?.id ?? 'missing',
  options: CompileOptions = {},
): Compilation {
  const fileErrors = [...parsed.fileErrors];
  const selected = parsed.maps[mapId];
  const map: MapDefinition = selected ?? {
    id: mapId,
    name: mapId,
    size: { x: 100, z: 100 },
    sun: { azimuth: 135, elevation: 45 },
    structures: [],
    markers: [],
    source: { file: `maps/${mapId}/map.yaml`, line: 1, path: [] },
  };
  if (!selected)
    fileErrors.push({
      file: map.source.file,
      line: 1,
      message: `Map "${mapId}" does not exist. Choose a map listed in project information.`,
    });
  const violations: ViolationView[] = [],
    sourceRefs: Compilation['sourceRefs'] = {};
  const instances: CompiledInstance[] = [],
    sockets: CompiledSocket[] = [],
    socketConnections: Compilation['socketConnections'] = [];
  const usedSockets = new Set<string>();
  const structures = [...map.structures].sort((a, b) => compareText(a.id, b.id));
  const byId = new Map(structures.map((s) => [s.id, s]));
  const terrainHeight = options.terrainHeight ?? (() => 0);
  const advice = createCompilerAdvice(parsed);

  const checkGridAlignment = (check: {
    values: number[];
    ref: string | undefined;
    source: SourceRef;
    label: string;
    field: OffGridField;
    /** Sizes cannot snap below one grid step. */
    minimum?: number;
    moduleType?: string;
    rule?: string;
  }): void => {
    const { values, ref, source, label, field, minimum = -Infinity, moduleType } = check;
    if (values.every((n) => onGrid(n))) return;
    const nearest = values.map((value) => Math.max(minimum, snap(value)));
    violations.push(
      createViolation({
        kind: 'off_grid',
        message: `${label} must use multiples of 0.5 meters.`,
        refs: ref ? [ref] : [],
        source,
        suggestion: advice.grid(label, nearest),
        params: { field, values, nearest, ...(moduleType ? { moduleType } : {}) },
        rule: check.rule ?? field,
      }),
    );
  };
  const checkRotation = (check: {
    value: number;
    step: 15 | 90;
    ref: string | undefined;
    source: SourceRef;
    field: RotationField;
    moduleType?: string;
    rule?: string;
  }): void => {
    const { value, step, ref, source, field, moduleType } = check;
    if (onGrid(value, step)) return;
    const nearest = snap(value, step);
    violations.push(
      createViolation({
        kind: 'bad_rotation',
        message: `Rotation ${value} degrees must be a multiple of ${step}.`,
        refs: ref ? [ref] : [],
        source,
        suggestion: advice.rotation(nearest),
        params: { field, rotation: value, step, nearest, ...(moduleType ? { moduleType } : {}) },
        rule: check.rule ?? field,
      }),
    );
  };
  for (const [type, definition] of Object.entries(parsed.project.socketTypes).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    for (const compatible of definition.compatibleWith)
      if (!parsed.project.socketTypes[compatible])
        violations.push(
          createViolation({
            kind: 'missing_reference',
            message: `Socket type "${type}" references unknown type "${compatible}".`,
            refs: [],
            source: parsed.project.source,
            suggestion: advice.unknownCompatibleType(compatible),
            params: { reason: 'unknown_socket_type', reference: compatible },
            rule: `socket-type:${type}:compatible-with:${compatible}`,
          }),
        );
  }
  for (const definition of Object.values(parsed.modules).sort((a, b) => compareText(a.id, b.id))) {
    const refs = structures.flatMap((s) =>
      s.modules.filter((m) => m.module === definition.id).map((m) => moduleRef(s.id, m.id)),
    );
    checkGridAlignment({
      values: definition.size,
      ref: refs[0],
      source: definition.source,
      label: `Module "${definition.id}" dimensions`,
      field: 'module_size',
      minimum: 0.5,
      moduleType: definition.id,
      rule: `definition:${definition.id}:size`,
    });
    if (definition.material && !parsed.project.materials.includes(definition.material))
      violations.push(
        createViolation({
          kind: 'missing_reference',
          message: `Unknown material "${definition.material}".`,
          refs,
          source: definition.source,
          suggestion: advice.unknownMaterial(definition.material),
          params: {
            reason: 'unknown_material',
            reference: definition.material,
            moduleType: definition.id,
          },
          rule: `definition:${definition.id}:material`,
        }),
      );
    for (const socket of definition.sockets) {
      checkGridAlignment({
        values: socket.position,
        ref: refs[0],
        source: socket.source,
        label: `Socket "${socket.id}" position`,
        field: 'socket_position',
        moduleType: definition.id,
        rule: `definition:${definition.id}:socket:${socket.id}:position`,
      });
      checkRotation({
        value: socket.rotation,
        step: 90,
        ref: refs[0],
        source: socket.source,
        field: 'socket',
        moduleType: definition.id,
        rule: `definition:${definition.id}:socket:${socket.id}:rotation`,
      });
      if (!parsed.project.socketTypes[socket.type])
        violations.push(
          createViolation({
            kind: 'missing_reference',
            message: `Unknown socket type "${socket.type}".`,
            refs,
            source: socket.source,
            suggestion: advice.unknownSocketType(socket.type),
            params: {
              reason: 'unknown_socket_type',
              reference: socket.type,
              moduleType: definition.id,
            },
            rule: `definition:${definition.id}:socket:${socket.id}:type`,
          }),
        );
    }
  }
  /** Socket addresses as written in attach: `instance.socket`, or `structure/instance.socket`. */
  const socketAddresses = (modules: readonly ModuleInstance[], structureId?: string): string[] =>
    modules.flatMap((instance) =>
      (parsed.modules[instance.module]?.sockets ?? []).map(
        (socket) => `${structureId ? `${structureId}/` : ''}${instance.id}.${socket.id}`,
      ),
    );
  const socketPairParams = (own: PlacedSocket, target: PlacedSocket) => ({
    socketA: `${own.instanceRef}.${own.socket.id}`,
    socketB: `${target.instanceRef}.${target.socket.id}`,
    typeA: own.socket.type,
    typeB: target.socket.type,
  });
  const connect = (own: PlacedSocket, target: PlacedSocket, source: SourceRef): void => {
    const a = `${own.instanceRef}.${own.socket.id}`,
      b = `${target.instanceRef}.${target.socket.id}`;
    if (!socketTypesCompatible(parsed.project.socketTypes, own.socket.type, target.socket.type))
      violations.push(
        createViolation({
          kind: 'incompatible_socket',
          message: `Socket types "${own.socket.type}" and "${target.socket.type}" cannot connect.`,
          refs: [own.instanceRef, target.instanceRef],
          source,
          suggestion: advice.incompatibleTypes(own, target),
          params: { reason: 'types', ...socketPairParams(own, target) },
          rule: `socket-types:${JSON.stringify([a, b].sort())}`,
        }),
      );
    if (usedSockets.has(a) || usedSockets.has(b))
      violations.push(
        createViolation({
          kind: 'incompatible_socket',
          message: 'A socket is already occupied by another connection.',
          refs: [own.instanceRef, target.instanceRef],
          source,
          suggestion: advice.occupied(
            own,
            target,
            [a, b].filter((ref) => usedSockets.has(ref)),
          ),
          params: { reason: 'occupied', ...socketPairParams(own, target) },
          rule: `socket-occupied:${JSON.stringify([a, b].sort())}`,
        }),
      );
    usedSockets.add(a);
    usedSockets.add(b);
    socketConnections.push({ a: own.instanceRef, b: target.instanceRef });
  };
  const attachmentMatrix = (own: PlacedSocket, target: PlacedSocket, source: SourceRef): Mat4 => {
    const { transform, facing } = socketAttachment(own, target);
    if (!facing) {
      const targetDirection = directionVector(
        target.socket.direction,
        target.socket.rotation + yawOf(target.transform),
      );
      violations.push(
        createViolation({
          kind: 'incompatible_socket',
          message: 'Socket directions cannot face each other with a Y-axis rotation.',
          refs: [own.instanceRef, target.instanceRef],
          source,
          suggestion: advice.directions(own, target, targetDirection[1]),
          params: { reason: 'directions', ...socketPairParams(own, target) },
          rule: `socket-directions:${JSON.stringify([`${own.instanceRef}.${own.socket.id}`, `${target.instanceRef}.${target.socket.id}`].sort())}`,
        }),
      );
    }
    return transform;
  };
  const localByStructure = new Map<string, Map<string, LocalInstance>>();
  for (const structure of structures) {
    const structureReference = structureRef(structure.id);
    sourceRefs[structureReference] = structure.source;
    if (!structure.attach) {
      checkGridAlignment({
        values: structure.position,
        ref: structureReference,
        source: structure.source,
        label: `Structure "${structure.id}" position`,
        field: 'structure_position',
      });
      if (structure.height !== 'auto')
        checkGridAlignment({
          values: [structure.height],
          ref: structureReference,
          source: structure.source,
          label: `Structure "${structure.id}" height`,
          field: 'structure_height',
        });
      checkRotation({
        value: structure.rotation,
        step: 15,
        ref: structureReference,
        source: structure.source,
        field: 'structure',
      });
    }
    const locals = new Map<string, LocalInstance>(),
      definitions = new Map(structure.modules.map((m) => [m.id, m])),
      visiting = new Set<string>(),
      failed = new Set<string>();
    const resolve = (instanceId: string): LocalInstance | undefined => {
      if (locals.has(instanceId)) return locals.get(instanceId);
      if (failed.has(instanceId)) return;
      const instance = definitions.get(instanceId);
      if (!instance) return;
      const ref = moduleRef(structure.id, instance.id);
      sourceRefs[ref] = instance.source;
      if (visiting.has(instanceId)) {
        violations.push(
          createViolation({
            kind: 'missing_reference',
            message: `Cyclic module attachment involving "${instance.id}".`,
            refs: [ref],
            source: instance.source,
            suggestion: advice.moduleCycle(),
            params: { reason: 'attachment_cycle', reference: instance.id },
            rule: 'module-attachment-cycle',
          }),
        );
        failed.add(instanceId);
        return;
      }
      const definition = parsed.modules[instance.module];
      if (!definition) {
        violations.push(
          createViolation({
            kind: 'missing_reference',
            message: `Module "${instance.module}" does not exist.`,
            refs: [ref],
            source: instance.source,
            suggestion: advice.unknownModule(instance.module),
            params: { reason: 'unknown_module', reference: instance.module },
            rule: 'module-type',
          }),
        );
        failed.add(instanceId);
        return;
      }
      visiting.add(instanceId);
      let transform: Mat4, attachTo: string | undefined;
      if (instance.attach) {
        const match = /^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/.exec(
          instance.attach.to,
        );
        const target = match ? resolve(match[1]!) : undefined;
        const ownSocket = definition.sockets.find((s) => s.id === instance.attach!.socket),
          targetSocketDefinition = target?.definition.sockets.find((s) => s.id === match?.[2]);
        if (!target || !ownSocket || !targetSocketDefinition) {
          if (!failed.has(instanceId))
            violations.push(
              createViolation({
                kind: 'missing_reference',
                message: `Cannot resolve attachment "${instance.attach.socket}" to "${instance.attach.to}".`,
                refs: [ref],
                source: instance.source,
                suggestion: advice.moduleAttachment(
                  instance.attach,
                  definition.sockets.map((socket) => socket.id),
                  socketAddresses(structure.modules.filter((other) => other.id !== instance.id)),
                ),
                params: { reason: 'unresolved_attachment', reference: instance.attach.to },
                rule: 'module-attachment',
              }),
            );
          visiting.delete(instanceId);
          failed.add(instanceId);
          return;
        }
        attachTo = moduleRef(structure.id, target.instance.id);
        const own: PlacedSocket = {
            socket: ownSocket,
            transform: transformMatrix([0, 0, 0]),
            instanceRef: ref,
          },
          targetSocket: PlacedSocket = {
            socket: targetSocketDefinition,
            transform: target.transform,
            instanceRef: attachTo,
          };
        transform = attachmentMatrix(own, targetSocket, instance.source);
        connect(own, targetSocket, instance.source);
        checkRotation({
          value: yawOf(transform),
          step: 90,
          ref,
          source: instance.source,
          field: 'attached_module',
        });
        checkGridAlignment({
          values: transformBounds(transform, definition.size).min,
          ref,
          source: instance.source,
          label: 'Attached module position',
          field: 'attached_module_position',
        });
      } else {
        checkGridAlignment({
          values: instance.at!,
          ref,
          source: instance.source,
          label: `Module "${instance.id}" position`,
          field: 'module_position',
        });
        checkRotation({
          value: instance.rotation,
          step: 90,
          ref,
          source: instance.source,
          field: 'module',
        });
        transform = moduleTransform(instance.at!, definition.size, instance.rotation);
      }
      const result: LocalInstance = {
        instance,
        definition,
        transform,
        ...(attachTo ? { attachTo } : {}),
      };
      locals.set(instanceId, result);
      visiting.delete(instanceId);
      return result;
    };
    for (const instance of [...structure.modules].sort((a, b) => compareText(a.id, b.id)))
      resolve(instance.id);
    localByStructure.set(structure.id, locals);
  }
  const placements = new Map<string, StructurePlacement>(),
    visiting = new Set<string>(),
    failed = new Set<string>();
  const localSocket = (structureId: string, text: string): PlacedSocket | undefined => {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/.exec(text);
    if (!match) return;
    const local = localByStructure.get(structureId)?.get(match[1]!);
    const socket = local?.definition.sockets.find((s) => s.id === match[2]);
    return local && socket
      ? {
          socket,
          transform: local.transform,
          instanceRef: moduleRef(structureId, local.instance.id),
        }
      : undefined;
  };
  const place = (structure: Structure): StructurePlacement | undefined => {
    if (placements.has(structure.id)) return placements.get(structure.id);
    if (failed.has(structure.id)) return;
    const ref = structureRef(structure.id);
    if (visiting.has(structure.id)) {
      violations.push(
        createViolation({
          kind: 'missing_reference',
          message: `Cyclic structure attachment involving "${structure.id}".`,
          refs: [ref],
          source: structure.source,
          suggestion: advice.structureCycle(),
          params: { reason: 'attachment_cycle', reference: structure.id },
          rule: 'structure-attachment-cycle',
        }),
      );
      failed.add(structure.id);
      return;
    }
    visiting.add(structure.id);
    let placement: StructurePlacement;
    if (structure.attach) {
      const match = /^([A-Za-z][A-Za-z0-9_-]*)\/(.+)$/.exec(structure.attach.to),
        targetStructure = match ? byId.get(match[1]!) : undefined;
      const targetPlacement = targetStructure ? place(targetStructure) : undefined;
      const own = localSocket(structure.id, structure.attach.socket),
        targetLocal =
          targetStructure && match ? localSocket(targetStructure.id, match[2]!) : undefined;
      if (!own || !targetLocal || !targetPlacement) {
        if (!failed.has(structure.id))
          violations.push(
            createViolation({
              kind: 'missing_reference',
              message: `Cannot resolve structure attachment to "${structure.attach.to}".`,
              refs: [ref],
              source: structure.source,
              suggestion: advice.structureAttachment(
                structure.attach,
                socketAddresses(structure.modules),
                structures
                  .filter((other) => other.id !== structure.id)
                  .flatMap((other) => socketAddresses(other.modules, other.id)),
              ),
              params: { reason: 'unresolved_attachment', reference: structure.attach.to },
              rule: 'structure-attachment',
            }),
          );
        visiting.delete(structure.id);
        failed.add(structure.id);
        return;
      }
      const target = {
        ...targetLocal,
        transform: multiplyMatrices(targetPlacement.transform, targetLocal.transform),
      };
      const transform = attachmentMatrix(own, target, structure.source);
      connect(own, target, structure.source);
      const relativeRotation = yawOf(transform) - yawOf(targetPlacement.transform);
      checkRotation({
        value: relativeRotation,
        step: 90,
        ref,
        source: structure.source,
        field: 'structure_attachment',
      });
      placement = { transform, root: targetPlacement.root };
    } else {
      const [x, z] = structure.position,
        height = structure.height === 'auto' ? snap(terrainHeight(x, z)) : structure.height;
      placement = {
        transform: transformMatrix([x, height, z], structure.rotation),
        root: structure.id,
      };
      // Adapt each independently positioned terrain-following root before resolving
      // structure attachments. Its Socket-connected descendants inherit the same
      // vertical offset, preserving every connection throughout the merged Structure.
      const locals = localByStructure.get(structure.id)!;
      const offsets = new Map<string, number>();
      const offsetFor = (local: LocalInstance): number => {
        const cached = offsets.get(local.instance.id);
        if (cached !== undefined) return cached;
        let offset = 0;
        if (local.instance.attach) {
          const targetId = local.instance.attach.to.split('.')[0]!;
          const target = locals.get(targetId);
          if (target) offset = offsetFor(target);
        } else if (local.definition.terrainFollow && structure.height === 'auto') {
          const mapTransform = multiplyMatrices(placement.transform, local.transform);
          const bounds = transformBounds(mapTransform, local.definition.size);
          offset =
            snap(
              terrainHeight(
                (bounds.min[0] + bounds.max[0]) / 2,
                (bounds.min[2] + bounds.max[2]) / 2,
              ),
            ) - mapTransform[13]!;
        }
        offsets.set(local.instance.id, offset);
        return offset;
      };
      for (const local of locals.values()) offsetFor(local);
      for (const local of locals.values())
        local.transform[13] = clean(local.transform[13]! + offsets.get(local.instance.id)!);
    }
    placements.set(structure.id, placement);
    visiting.delete(structure.id);
    return placement;
  };
  for (const structure of structures) place(structure);
  const scene: SceneSnapshot = {
    protocolVersion: 1,
    revision: options.revision ?? 0,
    map: { id: map.id, name: map.name, size: map.size, sun: map.sun },
    terrain: options.terrain ?? { revision: 0, chunks: [] },
    moduleTypes: Object.values(parsed.modules)
      .sort((a, b) => compareText(a.id, b.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        size: m.size,
        isFoundation: m.isFoundation,
        canFloat: m.canFloat,
        url: options.moduleUrl?.(m.id) ?? `/assets/modules/${encodeURIComponent(m.id)}.glb`,
      })),
    structures: [],
    generated: [],
    markers: [],
    violations,
    fileErrors,
  };
  const views = new Map<string, SceneSnapshot['structures'][number]>();
  const rootBounds = new Map<string, Bounds>();
  const boundsForRoot = (root: string): Bounds => {
    const cached = rootBounds.get(root);
    if (cached) return cached;
    const all = [...placements.entries()]
      .filter(([, placement]) => placement.root === root)
      .flatMap(([id, placement]) =>
        [...localByStructure.get(id)!.values()].map((local) =>
          transformBounds(
            multiplyMatrices(placement.transform, local.transform),
            local.definition.size,
          ),
        ),
      );
    const bounds: Bounds = {
      min: [0, 1, 2].map((axis) => Math.min(...all.map((item) => item.min[axis]!))) as Vec3,
      max: [0, 1, 2].map((axis) => Math.max(...all.map((item) => item.max[axis]!))) as Vec3,
    };
    rootBounds.set(root, bounds);
    return bounds;
  };
  for (const structure of structures) {
    const placement = placements.get(structure.id);
    if (!placement) continue;
    if (!views.has(placement.root)) {
      const root = byId.get(placement.root)!;
      views.set(placement.root, {
        ref: structureRef(root.id),
        ...(root.name ? { name: root.name } : {}),
        file: root.source.file,
        transform: placements.get(root.id)!.transform,
        instances: [],
      });
    }
    for (const local of [...localByStructure.get(structure.id)!.values()].sort((a, b) =>
      compareText(a.instance.id, b.instance.id),
    )) {
      const ref = moduleRef(structure.id, local.instance.id);
      const transform = multiplyMatrices(placement.transform, local.transform);
      const bounds = transformBounds(transform, local.definition.size);
      const compiled: CompiledInstance = {
        ref,
        structureId: placement.root,
        moduleType: local.definition.id,
        transform,
        size: local.definition.size,
        bounds,
        definition: local.definition,
        source: local.instance.source,
        ...(local.attachTo ? { attachTo: local.attachTo } : {}),
      };
      instances.push(compiled);
      views
        .get(placement.root)!
        .instances.push({ ref, moduleType: local.definition.id, transform });
      if (
        bounds.min[0] < -EPSILON ||
        bounds.min[2] < -EPSILON ||
        bounds.max[0] > map.size.x + EPSILON ||
        bounds.max[2] > map.size.z + EPSILON
      )
        violations.push(
          createViolation({
            kind: 'out_of_bounds',
            message: `Module "${ref}" extends outside the map.`,
            refs: [ref, structureRef(placement.root)],
            source: local.instance.source,
            suggestion: advice.bounds(
              structureRef(placement.root),
              boundsForRoot(placement.root),
              map.size,
            ),
            location: bounds.min,
            params: { edges: exceededMapEdges(bounds, map.size), bounds, size: map.size },
          }),
        );
      for (const socket of local.definition.sockets) {
        const socketRef = `${ref}.${socket.id}`;
        sockets.push({
          ref: socketRef,
          instanceRef: ref,
          id: socket.id,
          type: socket.type,
          position: transformPoint(transform, socket.position),
          direction: directionVector(socket.direction, yawOf(transform) + socket.rotation),
          occupied: usedSockets.has(socketRef),
        });
      }
    }
  }
  scene.structures = [...views.values()].sort((a, b) => compareText(a.ref, b.ref));
  for (const marker of [...map.markers].sort((a, b) => compareText(a.id, b.id))) {
    const ref = markerRef(marker.id),
      shape = marker.shape,
      position = markerPosition(shape);
    sourceRefs[ref] = marker.source;
    checkGridAlignment({
      values: position,
      ref,
      source: marker.source,
      label: `Marker "${marker.id}" position`,
      field: 'marker_position',
    });
    checkRotation({
      value: shape.rotation,
      step: 15,
      ref,
      source: marker.source,
      field: 'marker',
    });
    if (shape.kind === 'box')
      checkGridAlignment({
        values: shape.size,
        ref,
        source: marker.source,
        label: `Marker "${marker.id}" size`,
        field: 'marker_size',
        minimum: 0.5,
      });
    const definition = parsed.project.markerTypes[marker.type];
    if (!definition)
      violations.push(
        createViolation({
          kind: 'missing_reference',
          message: `Unknown marker type "${marker.type}".`,
          refs: [ref],
          source: marker.source,
          suggestion: advice.unknownMarkerType(marker.type),
          params: { reason: 'unknown_marker_type', reference: marker.type },
          rule: 'marker-type',
        }),
      );
    else if (definition.shape !== shape.kind)
      fileErrors.push({
        file: marker.source.file,
        line: marker.source.line,
        message: `Marker type "${marker.type}" requires shape.kind: ${definition.shape}.`,
      });
    let bounds = { min: position, max: position };
    if (shape.kind === 'box') {
      const centered = transformMatrix(position, shape.rotation);
      const localMin = transformPoint(
        transformMatrix([0, 0, 0], shape.rotation),
        shape.size.map((n) => -n / 2) as Vec3,
      );
      centered[12] = position[0] + localMin[0];
      centered[13] = position[1] + localMin[1];
      centered[14] = position[2] + localMin[2];
      bounds = transformBounds(centered, shape.size);
    }
    if (
      bounds.min[0] < -EPSILON ||
      bounds.min[2] < -EPSILON ||
      bounds.max[0] > map.size.x + EPSILON ||
      bounds.max[2] > map.size.z + EPSILON
    )
      violations.push(
        createViolation({
          kind: 'out_of_bounds',
          message: `Marker "${marker.id}" extends outside the map.`,
          refs: [ref],
          source: marker.source,
          suggestion: advice.bounds(ref, bounds, map.size),
          location: position,
          params: { edges: exceededMapEdges(bounds, map.size), bounds, size: map.size },
        }),
      );
    scene.markers.push({ ref, type: marker.type, shape, properties: marker.properties });
  }
  return {
    scene,
    instances,
    sockets,
    socketConnections,
    socketTypes: parsed.project.socketTypes,
    sourceRefs,
  };
}
