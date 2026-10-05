# Map format, version 1

All distances are meters. +Y is up, +X is east, and -Z is north. Positive rotations follow the right-hand rule around +Y (counterclockwise viewed from above). Positions, heights, module dimensions and socket positions use multiples of 0.5 meters. A map contains whole-meter tiles and measures 100–1000 meters on each side.

The compiler reads project-relative paths with `/` separators. YAML is authoritative. Files may temporarily contain violations while being edited; checking reports them and export refuses them. Unknown fields, non-finite numbers, duplicate ids, unsupported shapes, and malformed YAML produce file errors with filenames and one-based line numbers. Rule violations include a filename and line in `params` and an English suggestion.

Ids start with a letter and contain letters, digits, `_` or `-`. Choose meaningful, stable ids. Module ids are project-wide; structure and marker ids are map-wide; module instance ids are unique inside their source structure. Ids and paths use code-point ordering, independent of the host locale. Referencing files by insertion order never affects compilation.

## Project

`project.yaml`:

```yaml
version: 1
name: My game
style: toon
socketTypes:
  gate:
    compatibleWith: [gate, wall]
markerTypes:
  checkpoint:
    shape: point
```

`version` defaults to 1. `style` is how the editor and screenshots shade surfaces: `standard` (default, smooth lighting) or `toon` (cel shading in hard light bands, keeping textures, with dark ink outlines around modules). It does not change exported files.

Built-in socket types are `foundation`, `floor`, `wall`, `roof`, and `stair`. Their initial connections are foundation↔foundation/wall/floor/stair; floor↔floor/wall/stair; wall↔wall/roof; roof↔roof; stair↔stair. Compatibility is symmetric: either side's `compatibleWith` list permits a connection. A project entry replaces the built-in definition of the same name. Unknown types in compatibility lists are violations.

Built-in marker types are `spawn` (point) and `trigger` (box). Project marker types specify one of those shapes. Version 1 only supports built-in materials and rejects a project `materials` field. Built-in material ids are `wood_planks`, `dark_wood`, `stone_brick`, `plaster`, `roof_tiles`, `thatch`, `grass`, `dirt`, `gravel`, `metal`, `white`, `red`, and `blue`.

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

`name` defaults to id. `isFoundation`, `canFloat`, and `terrainFollow` default to false. `foundationStyle` is `skirt` (default) or `pillars`; it selects how the foundation extends down to terrain. `canFloat` exempts the module from the support requirement and allows it to support modules above or attached to it. `check` and `overview` list every `canFloat` instance, including grounded ones, so the exception remains visible. `terrainFollow` adapts a directly placed module's height to terrain beneath its center when the structure height is automatic. An explicit structure height takes precedence, including for floating islands. `material` is optional; recipes may assign materials themselves.

`sockets` defaults to an empty list. Every socket has an id, type, and local position. `direction` is north/east/south/west/up/down (default south). `rotation` defaults to 0 and is a multiple of 90 degrees; it rotates a horizontal direction or sets the twist of a vertical socket. Up connects to down; horizontal sockets face each other after attachment. Each socket has capacity one.

## Maps

`maps/<folder>/map.yaml`:

```yaml
id: village
name: River village
size: { x: 100, z: 100 }
sun: { azimuth: 135, elevation: 45 }
```

The id defaults to the folder name; name defaults to id; sun defaults to the example values. `sun.azimuth` is a compass bearing in degrees, measured clockwise from north when viewed from above: 0 is north (−Z), 90 east (+X), 180 south (+Z); the default 135 is southeast. `sun.elevation` is the angle above the horizon in degrees. The map covers x=0…size.x and z=0…size.z. Bounds checks use the whole rotated volume, including trigger boxes, not just the origin. Y is not bounded by map size.

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

Marker rotation uses 15-degree increments and defaults to 0. At rotation 0 a point marker faces south (+Z), which is glTF's forward direction; a positive rotation turns it counterclockwise viewed from above, like every other rotation. A spawn marker with rotation 90 therefore faces east (+X). Box size is positive. `properties` is an arbitrary JSON-compatible mapping, defaults to `{}`, and is exported unchanged as game data. Nested arrays and mappings are allowed; cyclic YAML aliases, non-finite numbers, and YAML-only types such as sets are file errors. Only point and box shapes are supported in version 1; routes are deferred.

## Terrain files

`terrain/height.png` and `terrain/surface.png` live beside each map's `map.yaml`. Image dimensions equal map size; one pixel is one 1×1-meter tile. Image column increases with +X, row increases with +Z. Heights are quantized in 0.5-meter increments; surface pixels identify the tile's surface. Use the terrain tool to edit these images; do not write a million tile entries into YAML. The terrain module documents its exact PNG encoding and supported surface ids.

Height PNGs are single-channel 16-bit grayscale, with `sample = meters * 2 + 32768`.
This represents -16384 through 16383.5 meters without loss. Surface PNGs are
single-channel 8-bit grayscale: 0 grass, 1 dirt, 2 gravel, 3 stone, 4 sand.
Missing both images means flat grass at zero; providing only one is a file error.
CRC, bit depth, channel count, dimensions and surface IDs are checked when loading.

Terrain commands use tile centers to select circular, rectangular or path regions.
`raise`/`lower` add/subtract an amount; `set_height` sets an absolute height;
`flatten` uses an explicit height or the selected tiles' rounded mean; `paint`
sets a surface; `mountain` adds height with a linear falloff toward the boundary.
Every stored result stays on a 0.5-meter step.

Meshes are generated in 32-meter chunks. Gentle adjacent tile heights (within one
meter) are averaged at corners and triangulated along the northwest/southeast
diagonal. Larger jumps retain the plateau and receive cliff faces. The height
sampler, exact collision checks and foundation clipping use those same triangles.
Terrain-following module roots carry their attached descendants with them, keeping
socket positions coincident. Foundations extend down without altering either PNG.

## Source editing and diagnostics

Human dragging snaps x/z to the 0.5-meter grid and rotation to 15 degrees. Auto-height structures follow terrain; explicit heights remain explicit. Markers move by the terrain-height difference between their old position and snapped destination, preserving a point's height above terrain or a box bottom's clearance. The resulting marker y coordinate is rounded to the 0.5-meter grid, so clearance may change by up to 0.25 meters on an interpolated slope. Existing numeric fields are edited at their YAML AST source ranges, preserving surrounding comments, quotes, spaces, and line endings exactly. Adding a previously omitted field or deleting an object uses the YAML Document API, retaining comments and scalar/flow styles while normalizing some incidental whitespace. A preview does not mutate source documents.

`mapedit check` checks every map by default; `--map <id>` selects one. Any violation or file error makes the exit code nonzero. `--json` always returns the same envelope, even for a single selected map:

```json
{ "maps": [{ "map": "village", "violations": [], "fileErrors": [], "floating": [] }] }
```

Each `floating` entry has `ref`, `moduleType`, and `position` (the module origin in map-space meters). It lists every `canFloat` instance, regardless of current ground contact, and does not count as a violation or change the exit code. MCP `check` and `overview` also return all maps unless `map` is specified; querying them leaves the editor's selected map unchanged.

`mapedit export --out <directory>` validates every map before writing any output, then creates `<map-id>.glb` for each map. `--map <id>` limits both validation and export to that map. A rejected export names invalid maps and retains existing output files. Project-wide malformed-file errors remain visible even when a map cannot be parsed.

Violation kinds from text compilation are `off_grid`, `bad_rotation`, `out_of_bounds`, `missing_reference`, and `incompatible_socket`; geometry adds `overlap` and `unsupported`. All must be resolved before export. Parser errors are a separate `fileErrors` array so the frontend can report a malformed file even when no object exists yet.

Violation IDs identify the rule and affected object refs across revisions; source
line shifts and measured coordinate changes do not change that identity. File-backed
violations include `params.file` and `params.line`. Geometry violations also include
a map-space `location` and a concrete suggestion. Overlap suggestions search the
four cardinal directions in 0.5 m steps up to 5 m; if no such move clears the
overlap, the suggestion identifies the objects and location. Unsupported modules
receive a downward-support suggestion within 3 m, a nearby compatible free socket,
or guidance to declare `canFloat` when floating is intentional. After applying a
suggestion, run `check` again to validate the resulting map.
