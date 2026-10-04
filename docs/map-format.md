# Map format, version 1

All distances are meters. +Y is up, +X is east, and -Z is north. Positive rotations follow the right-hand rule around +Y (counterclockwise viewed from above). Positions, heights, module dimensions and socket positions use multiples of 0.5 meters. A map contains whole-meter tiles and measures 100–1000 meters on each side.

The compiler reads project-relative paths with `/` separators. YAML is authoritative. Files may temporarily contain violations while being edited; checking reports them and export refuses them. Unknown fields, non-finite numbers, duplicate ids, unsupported shapes, and malformed YAML produce file errors with filenames and one-based line numbers. Rule violations include a filename and line in `params` and an English suggestion.

Ids start with a letter and contain letters, digits, `_` or `-`. Choose meaningful, stable ids. Module ids are project-wide; structure and marker ids are map-wide; module instance ids are unique inside their source structure. Referencing files by insertion order never affects compilation.

## Project

`project.yaml`:

```yaml
version: 1
name: My game
socketTypes:
  gate:
    compatibleWith: [gate, wall]
markerTypes:
  checkpoint:
    shape: point
```

`version` defaults to 1. Built-in socket types are `foundation`, `floor`, `wall`, `roof`, and `stair`. Their initial connections are foundation↔foundation/wall/floor/stair; floor↔floor/wall/stair; wall↔wall/roof; roof↔roof; stair↔stair. Compatibility is symmetric: either side's `compatibleWith` list permits a connection. A project entry replaces the built-in definition of the same name. Unknown types in compatibility lists are violations.

Built-in marker types are `spawn` (point) and `trigger` (box). Project marker types specify one of those shapes. `materials` may list project material identifiers; the geometry build must still provide an actual material. Built-in material ids are `wood_planks`, `dark_wood`, `stone_brick`, `plaster`, `roof_tiles`, `thatch`, `grass`, `dirt`, `gravel`, `metal`, `white`, `red`, and `blue`.

## Modules

Each `modules/<folder>/module.yaml` describes an immutable-size module. The id defaults to the folder name. `model.ts` in the same folder supplies its geometry using the modeling API.

```yaml
id: stone_foundation
name: Stone foundation
size: [2, 0.5, 2] # x, y, z; model occupies [0,size] in local coordinates
isFoundation: true
foundationStyle: skirt
material: stone_brick
sockets:
  - id: east
    type: foundation
    position: [2, 0.5, 1]
    direction: east
  - id: top
    type: floor
    position: [1, 0.5, 1]
    direction: up
    rotation: 0
```

`name` defaults to id. `isFoundation`, `canFloat`, and `terrainFollow` default to false. `foundationStyle` is `skirt` (default) or `pillars`; it selects how the foundation extends down to terrain. `canFloat` exempts the module from the support requirement. `terrainFollow` adapts a directly placed module's height to terrain beneath its center. `material` is optional; recipes may assign materials themselves.

`sockets` defaults to an empty list. Every socket has an id, type, and local position. `direction` is north/east/south/west/up/down (default south). `rotation` defaults to 0 and is a multiple of 90 degrees; it rotates a horizontal direction or sets the twist of a vertical socket. Up connects to down; horizontal sockets face each other after attachment. Each socket has capacity one.

## Maps

`maps/<folder>/map.yaml`:

```yaml
id: village
name: River village
size: { x: 100, z: 100 }
sun: { azimuth: 135, elevation: 45 }
```

The id defaults to the folder name; name defaults to id; sun defaults to the example values. The map covers x=0…size.x and z=0…size.z. Bounds checks use the whole rotated volume, including trigger boxes, not just the origin. Y is not bounded by map size.

## Structures and attachments

Every YAML file beneath `maps/<folder>/structures/` contains a `structures` list, with one or more entries:

```yaml
# East watchtower
structures:
  - id: watchtower_east
    name: East watchtower
    position: [20, 30] # x,z on the map grid
    height: auto
    rotation: 30
    modules:
      - id: base
        module: stone_foundation
        at: [0, 0, 0]
        rotation: 0
      - id: floor
        module: wood_floor
        attach: { socket: bottom, to: base.top }
```

`position` is the structure grid's origin, and `rotation` is a multiple of 15 degrees (default 0). `height` defaults to `auto`: sample the terrain at the structure origin and snap to the 0.5-meter grid. A numeric `height` is explicit, suitable for floating structures whose modules permit floating. The structure grid rotates with the structure; a module's world coordinates therefore need not be multiples of 0.5 when the structure is rotated.

A directly positioned module uses `at: [x,y,z]` and an optional rotation in 90-degree increments. `at` denotes the **minimum corner of its rotated bounding box** in structure coordinates. Model coordinates still begin at `[0,0,0]`; the compiler applies the required corner offset. Scaling is unsupported.

An attached module uses only `attach: { socket: own_socket, to: target_instance.target_socket }`. It must not specify `at` or `rotation`. The compiler solves position and rotation so the sockets coincide and face in opposite directions. Forward references are valid. Missing references, cycles, incompatible directions/types, and reusing an occupied socket are reported. No instance order is required.

To attach and merge an entire structure into another structure:

```yaml
structures:
  - id: east_annex
    attach: { socket: base.west, to: watchtower_east/base.east }
    modules:
      - id: base
        module: stone_foundation
        at: [0, 0, 0]
```

An attached structure must not supply `position`, `height`, or `rotation`. Its source socket is `instance.socket`; the target is `structure/instance.socket`. The target root remains the single compiled structure; moving it moves all attached structures, and deleting it deletes the complete merged structure. Modules retain their original stable `module:<sourceStructure>/<instance>` refs so edits and diagnostics still point to their source files. The merged structures share the root grid and only differ by 90-degree local turns. Breaking an attachment in YAML separates them again.

## Markers

`maps/<folder>/markers.yaml` is optional:

```yaml
markers:
  - id: player_spawn
    type: spawn
    shape: { kind: point, position: [10, 0, 10], rotation: 0 }
    properties: { team: blue }
  - id: village_gate
    type: trigger
    shape: { kind: box, center: [15, 1, 10], size: [2, 2, 4], rotation: 15 }
    properties: { event: enter_village }
```

Marker rotation uses 15-degree increments and defaults to 0. Box size is positive. `properties` is an arbitrary mapping, defaults to `{}`, and is exported unchanged as game data. Only point and box shapes are supported in version 1; routes are deferred.

## Terrain files

`terrain/height.png` and `terrain/surface.png` live beside each map's `map.yaml`. Image dimensions equal map size; one pixel is one 1×1-meter tile. Image column increases with +X, row increases with +Z. Heights are quantized in 0.5-meter increments; surface pixels identify the tile's surface. Use the terrain tool to edit these images; do not write a million tile entries into YAML. The terrain module documents its exact PNG encoding and supported surface ids.

## Source editing and diagnostics

Human dragging snaps x/z to the 0.5-meter grid and rotation to 15 degrees. Auto-height structures follow terrain; explicit heights remain explicit. Existing numeric fields are edited at their YAML AST source ranges, preserving surrounding comments, quotes, spaces, and line endings exactly. Adding a previously omitted field or deleting an object uses the YAML Document API, retaining comments and scalar/flow styles while normalizing some incidental whitespace. A preview does not mutate source documents.

`mapedit check --json` returns violations and file errors. Violation kinds from text compilation are `off_grid`, `bad_rotation`, `out_of_bounds`, `missing_reference`, and `incompatible_socket`; geometry adds `overlap` and `unsupported`. All must be resolved before export. Parser errors are a separate `fileErrors` array so the frontend can report a malformed file even when no object exists yet.
