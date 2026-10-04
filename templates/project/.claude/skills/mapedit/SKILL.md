---
name: mapedit
description: Build Mapedit structures and modules, change terrain, and fix map violations using project files and MCP.
---

# Author a map

Follow the check-and-screenshot workflow in the project AGENTS.md. Keep related
changes together and continue until both the rules and the image are correct.

## File format

`project.yaml` defines the project name, socket compatibility and marker types.
`maps/<id>/map.yaml` defines `id`, `name`, `size: {x, z}` (100–1000 metres) and
`sun: {azimuth, elevation}`. Structure files live in `maps/<id>/structures/`.

```yaml
structures:
  - id: house_east
    position: [40, 30]
    rotation: 15
    modules:
      - { id: base, module: foundation, at: [0, 0, 0] }
      - { id: floor, module: floor, attach: { socket: bottom, to: base.top } }
```

Positions and explicit heights use 0.5 metre steps. A structure has automatic
terrain height by default; set `height` only when intentional. Its rotation uses
15 degree steps. Module `at` is the minimum corner of its rotated bounds in the
structure's grid; module rotations use 90 degree steps. An attached module uses
only `attach`, with no `at` or `rotation`. Connected structures use
`attach: {socket: base.west, to: other_house/base.east}` and merge in the compiled
map. Socket positions are module coordinates, and directions face outward.

`markers.yaml` contains `markers`, each with `id`, `type`, `shape`, `properties`.
Point shape: `{kind: point, position: [20, 0, 30], rotation: 0}`.
Trigger shape: `{kind: box, center: [20, 1, 30], size: [2, 2, 2], rotation: 0}`.

## Modules

Each `modules/<id>/module.yaml` declares `id`, `size`, optional `material`,
`isFoundation`, `foundationStyle` (`skirt` or `pillars`), `canFloat`,
`terrainFollow`, and `sockets`. Each socket has `id`, `type`, `position`,
`direction` (`north/east/south/west/up/down`) and optional 90-degree `rotation`.
Inspect the provided modules for compatible bottom/top examples.

`model.ts` exports a shape from `@mapedit/model`:

```ts
import { box, difference, translate, material } from '@mapedit/model';
export default material(
  'wood_planks',
  difference(box([4, 3, 0.5]), translate(box([1, 2.5, 1.5]), [1.5, 0, -0.5])),
);
```

Other operations: `cylinder(radius,height,segments?)`, `extrude(xzPolygon,height)`,
`revolve(radiusHeightProfile,segments?)`, `union`, `intersection`, `rotate`.
All geometry must stay within the declared size. Code executes in isolation with
no filesystem, network or Node globals. Use MCP `build_module` for diagnostics
and a preview. Materials include wood_planks, dark_wood, stone_brick, plaster,
roof_tiles, thatch, grass, dirt, gravel, metal, white, red, blue. UVs are automatic.

## Terrain

Use the MCP `terrain` tool to modify the two PNG files. Height is signed 16-bit
grayscale: `sample = metres * 2 + 32768`; surface is an 8-bit ID. One pixel is one
square metre; rows increase toward +Z. Valid surfaces: grass, dirt, gravel, stone,
sand. Commands are raise/lower (`amount`), flatten (`height` optional), set_height
(`height`), mountain (`height`), paint (`surface`).

```json
{
  "command": {
    "operation": "paint",
    "surface": "gravel",
    "region": {
      "kind": "path",
      "points": [
        [10, 20],
        [40, 20]
      ],
      "width": 3
    }
  }
}
```

Other regions are `{kind:"circle",center:[x,z],radius:r}` and
`{kind:"rectangle",min:[x,z],max:[x,z]}`. Heights use 0.5 metre steps.

## Correct violations

- `off_grid` / `bad_rotation`: use the suggested grid or angle step.
- `overlap`: separate the actual solids; touching faces is allowed. Door openings
  remain empty. Foundations and terrain-following modules may enter terrain.
- `unsupported`: connect to grounded support, move to the terrain, or use
  `canFloat` only for intentionally floating modules.
- `missing_reference`: fix IDs and socket names in the reported file and line.
- `incompatible_socket`: inspect `free_sockets`; connect compatible opposite faces.
- `out_of_bounds`: keep the whole rotated shape inside the map.
- File errors: fix the YAML schema or model code before exporting.

Preserve comments explaining design intent. Terrain is not automatically flattened
under foundations; the compiler generates their extension geometry.
