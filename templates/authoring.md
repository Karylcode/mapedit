# Mapedit project

Build maps by editing project files. Use MCP to inspect, check, change terrain,
and see the result. All lengths are metres; +Y is up, +X is east, -Z is north.

## Workflow

1. Read the relevant map and structure YAML files. Use `modules` and `free_sockets`
   to discover dimensions and attachment choices.
2. Edit files using stable, descriptive IDs. Give each large structure its own file
   and preserve comments explaining design intent.
3. Run MCP `check` or `mapedit check --json` after each coherent change. Correct
   every reported violation and file error, then run the check again.
4. Call MCP `screenshot` for each changed map and inspect the returned image. Correct visual mistakes
   and repeat the check and screenshot until both are satisfactory.
5. Export after the checks pass. Use `mapedit export --out ./export`, adding
   `--map <id>` to export only one map.

CLI `check` and `export` process every map unless `--map <id>` is specified. MCP
`check` and `overview` likewise cover all maps unless `map` is specified, while
leaving the editor's selected map unchanged. CLI `check --json` always returns:

```json
{ "maps": [{ "map": "village", "violations": [], "fileErrors": [], "floating": [] }] }
```

A selected-map report contains one entry. Any invalid map makes an all-map export
fail before writing output. Review `floating`: it lists every `canFloat` instance's
ref, module type and world position, including grounded instances. These can support
other modules and are informational, not violations.

Run `mapedit dev` in this directory to enable HTTP MCP and the editor. The bundled
MCP configs use `http://127.0.0.1:4790/mcp`. When HTTP tools are unavailable, use
the alternate `.mcp.stdio.json` or `.codex/config.stdio.toml`. These start the
installed Node executable and CLI directly, avoiding Windows `npx` launch issues.
The stdio bridge attaches to this project's running server or starts one.
If the project or editor installation moves, update the absolute stdio paths.

Screenshots require the editor frontend and Edge or Chrome. When `/render` is not
available, report that visual verification is pending; a successful check alone
does not establish visual quality. Inspect screenshots through MCP image output.

## File format

`project.yaml` defines the project name, socket compatibility and marker types.
`maps/<folder>/map.yaml` defines `id`, `name`, `size: {x, z}` (100–1000 whole metres)
and `sun: {azimuth, elevation}`. An omitted `id` defaults to the folder name.
Structure files live beside that map in `structures/`; module definitions live in
`modules/<folder>/module.yaml`. IDs may differ from folder names. IDs start with
a letter and contain letters, digits, `_` or `-`.

```yaml
structures:
  - id: house_east
    position: [40, 30]
    rotation: 15
    modules:
      - { id: base, module: foundation, at: [0, 0, 0] }
      - { id: floor, module: floor, attach: { socket: bottom, to: base.top } }
```

`position` is `[x, z]`. Positions, explicit heights, dimensions and socket
coordinates use 0.5 metre steps. A structure has automatic terrain height by
default; set a numeric `height` for intentional elevation. Structure rotation uses
15 degree steps. Module `at` is `[x, y, z]`, the minimum corner of its rotated
bounds in the structure's grid; module rotations use 90 degree steps. An attached
module supplies only `attach`, with no `at` or `rotation`.

Connected structures use `attach: {socket: base.west, to: other_house/base.east}`
instead of `position`, `height` and `rotation`, and merge in the compiled map.
Moving or deleting their root affects the whole merged structure. Socket positions
are module coordinates, directions face outward, and each socket connects once.
Compatibility is symmetric: either type may declare the other in
`socketTypes.<type>.compatibleWith`.

`markers.yaml` beside the map contains `markers`, each with `id`, `type`, `shape`
and optional JSON-compatible `properties`. Built-in types are `spawn` and `trigger`:

```yaml
markers:
  - id: player_start
    type: spawn
    shape: { kind: point, position: [20, 0, 30], rotation: 0 }
  - id: entry_zone
    type: trigger
    shape: { kind: box, center: [20, 1, 30], size: [2, 2, 2], rotation: 0 }
    properties: { event: enter_village }
```

Marker rotation uses 15 degree steps. A box is positioned by its centre: a box
2 metres tall at ground height zero needs `center.y: 1`. Human dragging preserves
clearance relative to terrain, rounding the final y coordinate to 0.5 metres.

## Modules

Each `module.yaml` declares `size`, optional `id`, `material`, `isFoundation`,
`foundationStyle` (`skirt` or `pillars`), `canFloat`, `terrainFollow`, and `sockets`.
Each socket has `id`, `type`, `position`, `direction` (`north/east/south/west/up/down`)
and optional 90-degree `rotation`. Inspect the provided modules for bottom/top
examples. `canFloat` permits intentional floating and supports attached or stacked
modules. `terrainFollow` adapts a directly placed module to terrain when the
structure height is automatic; an explicit structure height takes precedence.

The neighbouring `model.ts` exports a shape from `@mapedit/model` (or a function
returning one). For a module with `size: [4, 3, 0.5]`:

```ts
import { box, difference, translate, material } from '@mapedit/model';
export default material(
  'wood_planks',
  difference(box([4, 3, 0.5]), translate(box([1, 2.5, 1.5]), [1.5, 0, -0.5])),
);
```

Other operations: `cylinder(radius,height,segments?)`, `extrude(xzPolygon,height)`,
`revolve(radiusHeightProfile,segments?)`, `union`, `intersection`, `rotate`.
All resulting geometry must stay within the declared `[0, size]` bounds. Code
executes in isolation with no filesystem, network or Node globals. Use MCP
`build_module` for diagnostics and a preview. Built-in materials are wood_planks,
dark_wood, stone_brick, plaster, roof_tiles, thatch, grass, dirt, gravel, metal,
white, red and blue. UVs are automatic.

## Terrain

Use the MCP `terrain` tool to modify `terrain/height.png` and `terrain/surface.png`
beside the map. Height is signed 16-bit grayscale: `sample = metres * 2 + 32768`;
surface is an 8-bit ID. One pixel is one square metre; rows increase toward +Z.
Valid surfaces: grass, dirt, gravel, stone, sand. Commands are raise/lower
(`amount`), flatten (`height` optional), set_height (`height`), mountain (`height`),
and paint (`surface`). Specify `map` when targeting another map.

```json
{
  "map": "village",
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
`{kind:"rectangle",min:[x,z],max:[x,z]}`. Heights use 0.5 metre steps. Terrain
remains unchanged under foundations; the compiler generates their extension
geometry down to the existing terrain.

## Common errors

- `off_grid` / `bad_rotation`: use the suggested legal coordinates or angle.
- `overlap`: apply the suggested direction and distance, then recheck. Touching
  faces is allowed; door openings remain empty. Foundations and terrain-following
  modules may enter terrain.
- `unsupported`: use the suggested drop to terrain or support, or the named free
  sockets. Use `canFloat: true` only for intentionally floating modules.
- `missing_reference`: compare the closest existing IDs and correct the reported
  file and line. Module IDs are project-wide; structure and marker IDs are map-wide;
  module instance IDs are unique within their source structure.
- `incompatible_socket`: use the listed compatible types and opposite faces.
  Inspect `free_sockets`; remove an old attachment before reusing an occupied socket.
- `out_of_bounds`: apply the suggested grid movement to fit the whole rotated shape
  inside the map. Resize or split a structure that is larger than the map.
- File errors: fix YAML schema, JSON-compatible marker data or model code before
  exporting. A model's result must fit its declared size, and terrain PNGs must
  both be present with dimensions matching the map, or both be omitted for flat terrain.
