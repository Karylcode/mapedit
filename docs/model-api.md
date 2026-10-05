# Module modelling API

Every Module has `module.yaml` and `model.ts`. The Module's local bounding box starts at `[0, 0, 0]` and ends at its declared `size`. Distances are metres. +Y is up, +X is east and -Z is north. Export a shape, or a synchronous function returning a shape. The function may use ordinary TypeScript, loops and arithmetic.

```ts
import { box, difference, material, translate } from '@mapedit/model';

// module.yaml declares size: [2, 3, 0.5].
const wall = box([2, 3, 0.5]);
const opening = translate(box([1, 2.5, 1]), [0.5, 0, -0.25]);
export default material('stone_brick', difference(wall, opening));
```

| Function                              | Meaning                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `box([x,y,z])`                        | Box from the origin to the specified positive dimensions.                                         |
| `cylinder(radius,height,segments=32)` | Cylinder centred on the Y axis, bottom at Y=0. Translate it into the declared local bounding box. |
| `extrude(polygon,height)`             | Extrude a counter-clockwise array of `[x,z]` points upward along +Y.                              |
| `revolve(profile,segments=32)`        | Revolve a polygon of `[radius,height]` points around +Y.                                          |
| `union(...shapes)`                    | Boolean union of solid shapes.                                                                    |
| `difference(shape,...cutters)`        | Subtract cutters, including through holes.                                                        |
| `intersection(...shapes)`             | Keep only shared volume.                                                                          |
| `translate(shape,[x,y,z])`            | Translate in metres.                                                                              |
| `rotate(shape,[x,y,z])`               | Euler rotation in degrees about the local origin, applied X then Y then Z.                        |
| `material(id,shape)`                  | Set the material on primitives inside this expression; inner material assignments override it.    |

Built-in material IDs: `wood_planks`, `dark_wood`, `stone_brick`, `plaster`, `roof_tiles`, `thatch`, `grass`, `dirt`, `gravel`, `metal`, `white`, `red`, `blue`. The Module's optional `material` in YAML provides the default. Boolean cut surfaces inherit their cutter's material (or the enclosing/default material). Material images, physical repeat widths and CC0 provenance are documented in [SOURCES.md](../packages/core/materials/SOURCES.md). Automatic orthonormal face-plane projection uses metre coordinates, so bricks keep the same size across Modules. GLBs embed images and contain normals and UVs.

The collider uses the closed solid's triangles, preserving holes such as doors and windows. Actual volume intersections are checked after a spatial-hash broad phase; surface contact is allowed. Numerical comparisons use a 0.0001 m positional tolerance and 0.000000001 m³ minimum intersection volume. Support propagates through physical bottom contact and Socket connections from terrain or Modules explicitly marked `canFloat`. Unanchored Socket cycles are unsupported.

Foundations accept `foundationStyle: skirt` (default) or `foundationStyle: pillars`. A skirt projects the actual shape footprint downward; pillars use four square supports up to 0.25 m wide. Both are clipped against terrain triangles, included in collision checks and exported separately. Terrain is never changed by Foundation generation.

## Execution boundary and limits

The server transpiles TypeScript with esbuild and permits only `@mapedit/model` imports. It evaluates the resulting code in a fresh [QuickJS WebAssembly runtime](https://github.com/justjake/quickjs-emscripten) inside an independent Node process. No host callbacks, module loader, filesystem, network, Node globals or environment variables are exposed to model code. The VM returns a JSON shape recipe; the trusted process validates it before invoking manifold-3d. Computed imports cannot load modules in that VM.

The child additionally enables Node's permission model with read access limited to installed dependencies and the core package, no filesystem writes, subprocesses or worker threads. [Node's permission model](https://nodejs.org/download/release/latest-v22.x/docs/api/permissions.html) alone is not a malicious-code sandbox; QuickJS isolation is the execution boundary. This also prevents network access on Node 22, whose permission model does not restrict networking.

Defaults and hard limits: 10-second process deadline (configurable up to 30 seconds), 32 MiB QuickJS memory, 512 KiB VM stack, 256 MiB Node heap, 1 MiB source, 4 MiB recipe, 32 MiB output, 4096 recipe operations, 128 nesting levels, 512 polygon points, 256 circular segments and 100000 output triangles. A timeout kills the entire child, including geometry generation. Invalid or oversized geometry is reported as a `model.ts` file error and prevents export. No model-generated code executes in the server process.

## Browser use of core

`packages/core` uses no Node-specific APIs. Its parsing, compilation, PNG, modelling and GLB APIs also run in browsers. When bundling with esbuild, use ESM output, `platform: 'browser'` and `external: ['node:*']`: manifold-3d and glTF Transform contain conditional Node-only imports that are never executed by these browser APIs. Serve the installed `manifold-3d/manifold.wasm` beside the generated JavaScript bundle with MIME type `application/wasm`. Other bundlers need the equivalent conditional-import handling and WASM asset deployment. `packages/server/test/browser-core.test.ts` validates the public APIs with an actual system browser.
