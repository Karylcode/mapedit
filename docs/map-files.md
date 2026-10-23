**English** | [繁體中文](map-files.zh-TW.md) · [Documentation index](README.md)

# Map files

A map is a set of text files in a project folder, and those files are the map itself. Agents edit them
like code; the editor reads them, works out every position, and reports violations. This page is a guide.
The full reference is [Map format, version 1](map-format.md); modelling is in
[Module modelling API](model-api.md).

## Units and grid

- Everything is in meters. +Y is up, +X is east, -Z is north (as in Minecraft).
- Positions, heights, module sizes and socket positions are multiples of 0.5 m. Files hold meters
  (`12.5`), not grid counts.
- Positive rotations turn counterclockwise seen from above. Structures turn in 15° steps; modules inside a
  structure turn in 90° steps.
- A map is 100 to 1000 m on each side, in whole meters.
- Each structure has its own grid that turns with it, so a module in a turned structure can sit off the
  map's 0.5 m grid.

## Project layout

```text
my-maps/                         project
├── project.yaml                 name, style, custom socket types and marker types
├── modules/
│   └── wall/                    one folder per module
│       ├── module.yaml          size, sockets, foundation and floating flags
│       └── model.ts             the module's shape, written as code
├── maps/
│   └── village/
│       ├── map.yaml             id, name, size, sun
│       ├── structures/          structure files, one or more structures each
│       │   └── house.yaml
│       ├── markers.yaml         spawn points, trigger boxes (optional)
│       └── terrain/
│           ├── height.png
│           └── surface.png
├── AGENTS.md                    instructions for agents (Codex reads it)
└── .claude/skills/mapedit/      the same instructions as a Claude Code skill
```

Ids start with a letter and contain letters, digits, `_` or `-`. Module ids are unique in the project,
structure and marker ids in the map, and module instance ids in their structure. A module or map id
defaults to its folder name.

## project.yaml

```yaml
name: My game
style: toon
socketTypes:
  gate:
    compatibleWith: [gate, wall]
markerTypes:
  checkpoint:
    shape: point
```

- `style` sets how the editor and screenshots shade surfaces: `standard` (default) or `toon` (cel shading
  with ink outlines). It does not change exported files.
- Built-in socket types are `foundation`, `floor`, `wall`, `roof` and `stair`. They connect
  foundation↔foundation/wall/floor/stair, floor↔floor/wall/stair, wall↔wall/roof, roof↔roof and
  stair↔stair. Compatibility works both ways: either side's `compatibleWith` is enough.
- Built-in marker types are `spawn` (a point) and `trigger` (a box).
- Version 1 has only built-in materials: `wood_planks`, `dark_wood`, `stone_brick`, `plaster`,
  `roof_tiles`, `thatch`, `grass`, `dirt`, `gravel`, `metal`, `white`, `red`, `blue`.

## Modules

A module is a reusable building piece with a fixed size. Modules never scale; make another module for
another size.

```yaml
id: stone_foundation
size: [2, 0.5, 2] # x, y, z; the model fills [0, size]
isFoundation: true
foundationStyle: skirt # or pillars
material: stone_brick
sockets:
  - { id: east, type: foundation, position: [2, 0.5, 1], direction: east }
  - { id: top, type: floor, position: [1, 0.5, 1], direction: up }
```

- `direction` is `north`, `east`, `south`, `west`, `up` or `down`. Each socket takes one connection.
- `isFoundation` modules reach down to uneven terrain: a `skirt` follows the footprint, `pillars` uses four
  posts. The terrain itself never changes.
- `canFloat: true` frees a module from needing support, and lets it hold up what sits on it. `check` and
  `overview` always list these modules so misuse stays visible.
- `terrainFollow: true` lets a directly placed module follow the terrain under its center, when the
  structure height is automatic.

`model.ts` builds the shape with `box`, `cylinder`, `extrude`, `revolve`, `union`, `difference`,
`intersection`, `translate`, `rotate` and `material`. The shape must fit inside the declared size.
Textures are projected at real-world size, so you never deal with UVs. The code runs in an isolated
QuickJS sandbox with no file, network or Node.js access.

```ts
import { box, difference, material, translate } from '@mapedit/model';

// module.yaml declares size: [2, 3, 0.5].
const wall = box([2, 3, 0.5]);
const opening = translate(box([1, 2.5, 1]), [0.5, 0, -0.25]);
export default material('stone_brick', difference(wall, opening));
```

## Maps

```yaml
id: village
name: River village
size: { x: 100, z: 100 }
sun: { azimuth: 135, elevation: 45 }
```

The map covers x = 0…size.x and z = 0…size.z. `sun.azimuth` is a compass bearing (0 north, 90 east, 180
south); `elevation` is degrees above the horizon.

## Structures

A structure is a group of modules joined by sockets that moves as one. Each file under `structures/` holds
a `structures` list: give a large structure its own file, and put small loose things together.

```yaml
# East watchtower
structures:
  - id: watchtower_east
    position: [20, 30] # x, z
    rotation: 30 # multiple of 15
    modules:
      - { id: base, module: stone_foundation, at: [0, 0, 0] }
      - { id: floor, module: wood_floor, attach: { socket: bottom, to: base.top } }
```

- `height` defaults to `auto`: the structure sits on the terrain at its origin. A number fixes the height,
  for example for a floating island.
- A module either has `at: [x, y, z]` (the minimum corner of its rotated bounds) and an optional
  `rotation`, or only `attach`. The editor works out where attached modules go.
- A whole structure can attach to another with `attach: { socket: base.west, to: other/base.east }`
  instead of `position`, `height` and `rotation`. The two merge: moving or deleting the root moves or
  deletes both.
- Comments are kept when the editor writes your changes back.

## Markers

`markers.yaml` holds points and boxes that mean something to the game. They have no shape of their own.

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

At rotation 0 a point marker faces south (+Z); rotation 90 faces east. A box is placed by its center, so a
2 m tall box on ground at height 0 needs `center.y: 1`. `properties` is any JSON-compatible mapping and is
exported unchanged.

## Terrain

Terrain is made of 1 × 1 m tiles. Each tile has a height (in 0.5 m steps) and a surface: `grass`, `dirt`,
`gravel`, `stone` or `sand`. It is stored as two PNGs beside `map.yaml`, one pixel per tile:

- `terrain/height.png`: 16-bit grayscale, `sample = meters * 2 + 32768`;
- `terrain/surface.png`: 8-bit grayscale, 0 grass, 1 dirt, 2 gravel, 3 stone, 4 sand.

With neither file, the map is flat grass at height 0. Only one of them is a file error. A 1000 m map has a
million tiles, so do not write terrain by hand: use the MCP `terrain` tool (`raise`, `lower`, `flatten`,
`set_height`, `mountain`, `paint` over a circle, rectangle or path). The editor smooths gentle steps into
slopes and turns jumps of more than 1 m into cliffs. Trees and rocks are modules placed on the terrain.

## Violations

Files may contain violations while you work, like code in the middle of an edit. The editor marks them at
once; a map with any violation does not export.

| Kind                  | Meaning                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `overlap`             | Two modules' real shapes intersect. Touching is fine; foundations and terrain-following modules may enter the ground |
| `unsupported`         | Nothing holds the module up all the way down to the ground, and it is not `canFloat` |
| `incompatible_socket` | Socket types or directions do not match, or a socket is already used           |
| `off_grid`            | A position or height is not on the 0.5 m grid                                  |
| `bad_rotation`        | An angle is not a 15° (structure, marker) or 90° (module) step                 |
| `out_of_bounds`       | Something reaches outside the map                                              |
| `missing_reference`   | A module, socket, structure, material or type that does not exist, or attachments that form a loop |

File errors are separate: malformed YAML, unknown fields, duplicate ids, or a `model.ts` that fails. They
come with the file name and line. Violations come with a suggested fix, for example a direction and
distance that clears an overlap. Run `check` again after applying one.
