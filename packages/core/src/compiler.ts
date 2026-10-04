import type {
  Mat4,
  SceneSnapshot,
  TerrainView,
  Vec3,
  ViolationKind,
  ViolationView,
} from '@mapedit/protocol';
import type {
  Compilation,
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
  normalizeRotation,
  onGrid,
  snap,
  transformBounds,
  transformMatrix,
  transformPoint,
  yawOf,
} from './math.js';
import { violationId } from './violation.js';

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
interface SocketAnchor {
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
  const emit = (
    kind: ViolationKind,
    message: string,
    refs: string[],
    source: SourceRef,
    suggestion: string,
    location?: Vec3,
    params: Record<string, unknown> = {},
    rule = '',
  ): void => {
    violations.push({
      id: violationId({ kind, refs, rule }),
      kind,
      message,
      refs,
      params: { file: source.file, line: source.line, ...params },
      suggestion,
      ...(location ? { location } : {}),
    });
  };
  const grid = (values: number[], ref: string, source: SourceRef, label: string): void => {
    if (values.some((n) => !onGrid(n)))
      emit(
        'off_grid',
        `${label} must use multiples of 0.5 meters.`,
        [ref],
        source,
        'Round each coordinate or dimension to the nearest 0.5 meters.',
        undefined,
        { values },
        label,
      );
  };
  const rotation = (
    value: number,
    step: number,
    ref: string,
    source: SourceRef,
    rule = 'rotation',
  ): void => {
    if (!onGrid(value, step))
      emit(
        'bad_rotation',
        `Rotation ${value} degrees must be a multiple of ${step}.`,
        [ref],
        source,
        `Use ${snap(value, step)} degrees.`,
        undefined,
        { rotation: value, step },
        rule,
      );
  };
  for (const [type, definition] of Object.entries(parsed.project.socketTypes).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    for (const compatible of definition.compatibleWith)
      if (!parsed.project.socketTypes[compatible])
        emit(
          'missing_reference',
          `Socket type "${type}" references unknown type "${compatible}".`,
          [],
          parsed.project.source,
          `Define socketTypes.${compatible} or correct compatibleWith.`,
          undefined,
          { reference: compatible },
          `socket-type:${type}:compatible-with:${compatible}`,
        );
  }
  for (const definition of Object.values(parsed.modules).sort((a, b) => compareText(a.id, b.id))) {
    const refs = structures.flatMap((s) =>
      s.modules.filter((m) => m.module === definition.id).map((m) => `module:${s.id}/${m.id}`),
    );
    grid(
      definition.size,
      refs[0] ?? `moduleType:${definition.id}`,
      definition.source,
      `Module "${definition.id}" dimensions`,
    );
    if (definition.material && !parsed.project.materials.includes(definition.material))
      emit(
        'missing_reference',
        `Unknown material "${definition.material}".`,
        refs,
        definition.source,
        'Choose a built-in material or declare the project material.',
        undefined,
        { reference: definition.material },
        `module:${definition.id}:material`,
      );
    for (const socket of definition.sockets) {
      grid(
        socket.position,
        refs[0] ?? `moduleType:${definition.id}`,
        socket.source,
        `Socket "${socket.id}" position`,
      );
      rotation(
        socket.rotation,
        90,
        refs[0] ?? `moduleType:${definition.id}`,
        socket.source,
        `socket:${definition.id}/${socket.id}:rotation`,
      );
      if (!parsed.project.socketTypes[socket.type])
        emit(
          'missing_reference',
          `Unknown socket type "${socket.type}".`,
          refs,
          socket.source,
          `Define socketTypes.${socket.type} in project.yaml.`,
          undefined,
          {},
          `socket:${definition.id}/${socket.id}:type`,
        );
    }
  }
  const compatible = (a: Socket, b: Socket): boolean =>
    Boolean(
      parsed.project.socketTypes[a.type]?.compatibleWith.includes(b.type) ||
      parsed.project.socketTypes[b.type]?.compatibleWith.includes(a.type),
    );
  const connect = (own: SocketAnchor, target: SocketAnchor, source: SourceRef): void => {
    const a = `${own.instanceRef}.${own.socket.id}`,
      b = `${target.instanceRef}.${target.socket.id}`;
    if (!compatible(own.socket, target.socket))
      emit(
        'incompatible_socket',
        `Socket types "${own.socket.type}" and "${target.socket.type}" cannot connect.`,
        [own.instanceRef, target.instanceRef],
        source,
        'Choose compatible socket types or update project compatibility rules.',
        undefined,
        { socketA: a, socketB: b },
        `socket-types:${JSON.stringify([a, b].sort())}`,
      );
    if (usedSockets.has(a) || usedSockets.has(b))
      emit(
        'incompatible_socket',
        'A socket is already occupied by another connection.',
        [own.instanceRef, target.instanceRef],
        source,
        'Use a free socket; each socket permits one connection.',
        undefined,
        { socketA: a, socketB: b },
        `socket-occupied:${JSON.stringify([a, b].sort())}`,
      );
    usedSockets.add(a);
    usedSockets.add(b);
    socketConnections.push({ a: own.instanceRef, b: target.instanceRef });
  };
  const attachmentMatrix = (own: SocketAnchor, target: SocketAnchor, source: SourceRef): Mat4 => {
    const ownDirection = directionVector(
      own.socket.direction,
      own.socket.rotation + yawOf(own.transform),
    );
    const targetDirection = directionVector(
      target.socket.direction,
      target.socket.rotation + yawOf(target.transform),
    );
    let yaw: number;
    if (Math.abs(ownDirection[1]) > EPSILON || Math.abs(targetDirection[1]) > EPSILON) {
      if (
        Math.abs(ownDirection[1] + targetDirection[1]) > EPSILON ||
        Math.abs(ownDirection[1]) < EPSILON
      )
        emit(
          'incompatible_socket',
          'Socket directions cannot face each other with a Y-axis rotation.',
          [own.instanceRef, target.instanceRef],
          source,
          'Connect up to down, or connect two horizontal sockets.',
          undefined,
          {},
          `socket-directions:${JSON.stringify([`${own.instanceRef}.${own.socket.id}`, `${target.instanceRef}.${target.socket.id}`].sort())}`,
        );
      yaw =
        yawOf(target.transform) +
        target.socket.rotation -
        yawOf(own.transform) -
        own.socket.rotation;
    } else
      yaw =
        (Math.atan2(targetDirection[0], targetDirection[2]) * 180) / Math.PI +
        180 -
        (Math.atan2(ownDirection[0], ownDirection[2]) * 180) / Math.PI;
    yaw = normalizeRotation(yaw);
    const ownPoint = transformPoint(own.transform, own.socket.position),
      targetPoint = transformPoint(target.transform, target.socket.position);
    const rotated = transformPoint(transformMatrix([0, 0, 0], yaw), ownPoint);
    return transformMatrix(targetPoint.map((n, i) => clean(n - rotated[i]!)) as Vec3, yaw);
  };
  const localByStructure = new Map<string, Map<string, LocalInstance>>();
  for (const structure of structures) {
    const structureRef = `structure:${structure.id}`;
    sourceRefs[structureRef] = structure.source;
    if (!structure.attach) {
      grid(
        [...structure.position, ...(structure.height === 'auto' ? [] : [structure.height])],
        structureRef,
        structure.source,
        `Structure "${structure.id}" position`,
      );
      rotation(structure.rotation, 15, structureRef, structure.source);
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
      const ref = `module:${structure.id}/${instance.id}`;
      sourceRefs[ref] = instance.source;
      if (visiting.has(instanceId)) {
        emit(
          'missing_reference',
          `Cyclic module attachment involving "${instance.id}".`,
          [ref],
          instance.source,
          'Give one module an at position and remove the attachment cycle.',
          undefined,
          {},
          'module-attachment-cycle',
        );
        failed.add(instanceId);
        return;
      }
      const definition = parsed.modules[instance.module];
      if (!definition) {
        emit(
          'missing_reference',
          `Module "${instance.module}" does not exist.`,
          [ref],
          instance.source,
          'Use an existing module id or create its module.yaml and model.ts.',
          undefined,
          { reference: instance.module },
          'module-type',
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
          targetSocket = target?.definition.sockets.find((s) => s.id === match?.[2]);
        if (!target || !ownSocket || !targetSocket) {
          if (!failed.has(instanceId))
            emit(
              'missing_reference',
              `Cannot resolve attachment "${instance.attach.socket}" to "${instance.attach.to}".`,
              [ref],
              instance.source,
              'Use attach: { socket: own_socket, to: instance_id.socket_id } with existing ids.',
              undefined,
              { reference: instance.attach.to },
              'module-attachment',
            );
          visiting.delete(instanceId);
          failed.add(instanceId);
          return;
        }
        attachTo = `module:${structure.id}/${target.instance.id}`;
        const own: SocketAnchor = {
            socket: ownSocket,
            transform: transformMatrix([0, 0, 0]),
            instanceRef: ref,
          },
          targetAnchor: SocketAnchor = {
            socket: targetSocket,
            transform: target.transform,
            instanceRef: attachTo,
          };
        transform = attachmentMatrix(own, targetAnchor, instance.source);
        connect(own, targetAnchor, instance.source);
        rotation(yawOf(transform), 90, ref, instance.source);
        grid(
          transformBounds(transform, definition.size).min,
          ref,
          instance.source,
          'Attached module position',
        );
      } else {
        grid(instance.at!, ref, instance.source, `Module "${instance.id}" position`);
        rotation(instance.rotation, 90, ref, instance.source);
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
  const localAnchor = (structureId: string, text: string): SocketAnchor | undefined => {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/.exec(text);
    if (!match) return;
    const local = localByStructure.get(structureId)?.get(match[1]!);
    const socket = local?.definition.sockets.find((s) => s.id === match[2]);
    return local && socket
      ? {
          socket,
          transform: local.transform,
          instanceRef: `module:${structureId}/${local.instance.id}`,
        }
      : undefined;
  };
  const place = (structure: Structure): StructurePlacement | undefined => {
    if (placements.has(structure.id)) return placements.get(structure.id);
    if (failed.has(structure.id)) return;
    const ref = `structure:${structure.id}`;
    if (visiting.has(structure.id)) {
      emit(
        'missing_reference',
        `Cyclic structure attachment involving "${structure.id}".`,
        [ref],
        structure.source,
        'Keep one structure positioned and remove the attachment cycle.',
        undefined,
        {},
        'structure-attachment-cycle',
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
      const own = localAnchor(structure.id, structure.attach.socket),
        targetLocal =
          targetStructure && match ? localAnchor(targetStructure.id, match[2]!) : undefined;
      if (!own || !targetLocal || !targetPlacement) {
        if (!failed.has(structure.id))
          emit(
            'missing_reference',
            `Cannot resolve structure attachment to "${structure.attach.to}".`,
            [ref],
            structure.source,
            'Use attach: { socket: own_instance.socket, to: other_structure/instance.socket }.',
            undefined,
            {},
            'structure-attachment',
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
      rotation(relativeRotation, 90, ref, structure.source);
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
          const world = multiplyMatrices(placement.transform, local.transform);
          const bounds = transformBounds(world, local.definition.size);
          offset =
            snap(
              terrainHeight(
                (bounds.min[0] + bounds.max[0]) / 2,
                (bounds.min[2] + bounds.max[2]) / 2,
              ),
            ) - world[13]!;
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
  for (const structure of structures) {
    const placement = placements.get(structure.id);
    if (!placement) continue;
    if (!views.has(placement.root)) {
      const root = byId.get(placement.root)!;
      views.set(placement.root, {
        ref: `structure:${root.id}`,
        ...(root.name ? { name: root.name } : {}),
        file: root.source.file,
        transform: placements.get(root.id)!.transform,
        instances: [],
      });
    }
    for (const local of [...localByStructure.get(structure.id)!.values()].sort((a, b) =>
      compareText(a.instance.id, b.instance.id),
    )) {
      const ref = `module:${structure.id}/${local.instance.id}`;
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
        emit(
          'out_of_bounds',
          `Module "${ref}" extends outside the map.`,
          [ref, `structure:${placement.root}`],
          local.instance.source,
          'Move the structure until its whole shape lies inside the map.',
          bounds.min,
          { bounds, size: map.size },
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
    const ref = `marker:${marker.id}`,
      shape = marker.shape,
      position = shape.kind === 'point' ? shape.position : shape.center;
    sourceRefs[ref] = marker.source;
    grid(position, ref, marker.source, `Marker "${marker.id}" position`);
    rotation(shape.rotation, 15, ref, marker.source);
    if (shape.kind === 'box') grid(shape.size, ref, marker.source, `Marker "${marker.id}" size`);
    const definition = parsed.project.markerTypes[marker.type];
    if (!definition)
      emit(
        'missing_reference',
        `Unknown marker type "${marker.type}".`,
        [ref],
        marker.source,
        `Define markerTypes.${marker.type} in project.yaml.`,
        undefined,
        {},
        'marker-type',
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
      emit(
        'out_of_bounds',
        `Marker "${marker.id}" extends outside the map.`,
        [ref],
        marker.source,
        'Move the marker inside the map boundaries.',
        position,
      );
    scene.markers.push({ ref, type: marker.type, shape, properties: marker.properties });
  }
  return { scene, instances, sockets, socketConnections, sourceRefs };
}
