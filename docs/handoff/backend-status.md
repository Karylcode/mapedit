# Backend implementation status

**Review entry point for Claude:** M0–M7 backend implementation is complete; the
F1–F16 review corrections in `docs/handoff/backend-fixes.md` are now in progress
on the same `backend` branch and PR. See the review correction log below.
Start with `docs/protocol.md`, `docs/map-format.md`,
`docs/model-api.md` and `docs/export-format.md`; the executable boundaries are
`packages/core/src/index.ts`, `packages/server/src/index.ts` and the CLI.
Protocol stays at version 1; the only additive HTTP contract detail is CLI identity
headers and a cheap HEAD discovery request. `packages/web` has not been created or
modified. The mock remains available through `mapedit dev --mock`.
On this Windows machine: 94 tests, strict typecheck and ESLint passed; the no-AI
village script reached zero violations and exported a GLB; real Unity 6 batchmode
verified 40 MeshColliders, the spawn prefab and trigger. Frontend rendering and the
two-agent/Unity Play experience remain the planned joint acceptance after the
frontend exists. GitHub publication and CI status are recorded below.

## 目前進度

Implementing F1–F16 in order, with regression tests before bug fixes and numbered
commits. The earlier M0–M7 validation below remains the baseline, not the final
acceptance for this correction pass.

M0–M7 complete and pushed on `backend`, each with its own milestone commit.
[PR #1](https://github.com/Karylcode/mapedit/pull/1) is open against `main`.
[GitHub CI](https://github.com/Karylcode/mapedit/actions/runs/37223538534) passes
all four combinations of Windows/Ubuntu and Node 22/24 at implementation commit
`b5a6dd8`. All 94 tests pass, including the unchanged 30 ms preview target and a
regression for fresh Agent edits during a drag. The backend is ready for Claude's
review, followed by frontend implementation and the planned joint acceptance.

## 每個里程碑完成了什麼、怎麼驗證

- M0: strict ESM TypeScript workspace, pnpm lockfile, Vitest, ESLint, Prettier,
  Windows/Linux CI, full protocol v1 types and `mapedit dev --mock`.
  Mock serves valid box GLBs, project/scene endpoints and in-memory edits/history.
  Windows validation: 6 protocol integration tests passed; protocol/server/CLI
  typechecks and scoped ESLint passed. All 6 client messages, all 6 server message
  variants and all notice codes are exercised. MCP transport is added in M5.
- M1: documented the full format in `docs/map-format.md`; browser-compatible YAML
  parsing/editing, deterministic compilation, socket alignment and structure merging,
  both grid rotation rules, source diagnostics and `mapedit check --json`.
  Windows validation: 22 compiler tests, deterministic golden snapshot, CLI success/
  nonzero exit tests, and a 2,000-module compile regression passed. Numeric edits
  preserve byte-level layout including CRLF and comments. Full typecheck, lint and
  all 51 tests currently present passed before this milestone commit.
- M2: Manifold modelling API, esbuild compilation and isolated model runner,
  dimension validation, GLB materials/UVs, exact shape colliders and intersections,
  rooted support graph, terrain penetration exceptions and skirt/pillar foundations.
  Includes 13 named materials and 9 bundled CC0 Poly Haven JPEGs with verified
  checksums/provenance (`packages/core/materials/SOURCES.md`). All runtime assets
  are local. Windows geometry/runner tests cover openings, contact tolerance,
  stacked/socket support, floating exceptions, rotated foundations, metre-scale
  slope UVs, malicious imports/globals and timeouts. 2,000-module compile plus
  exact geometry checking passed the 2-second bound (isolated measurement 53 ms).
- M3: signed 16-bit height PNGs, surface PNGs, all six terrain operations and
  circle/rectangle/path regions; deterministic ramps/cliffs and 32-meter GLB chunks.
  Full project builds load models/textures/terrain, report input errors, and cache
  immutable geometry/assets. Terrain-following attachment chains stay connected;
  rotated foundations clip against the same triangles used by the renderer.
  Windows acceptance: all 1,024 GLBs for a 1000×1000-meter map generated in the test;
  real-file build tests cover missing/oversized model repair, terrain contact and
  cache isolation. Warm previews of a 30-structure village pass the 30 ms bound.
  Typecheck, lint and all 67 tests currently present passed before this commit.
- M4: real local server, authoring-file watcher, current-file flush barriers,
  immutable GLB asset URLs, all WebSocket flows and map-scoped scene broadcasts.
  Human moves snap/auto-height, validate exact geometry and preserve YAML comments;
  deletion stays allowed. Project-wide human/Agent source checkpoints support
  undo/redo including PNG/model changes. Concurrent edit notices compare actual
  affected objects and distinguish maps even when IDs match. Host, Origin, static
  path traversal and symlink checks are enforced. Acceptance covers all protocol
  flows plus actual 24-module village previews under 30 ms median roundtrip.
- M5: fixed ten-tool MCP interface over Streamable HTTP and stdio; CLI stdio
  discovers this project's live server or starts one. Responses are paginated and
  bounded. Screenshots and isolated new-module previews return image content with
  no structuredContent. A system-browser service calls the unchanged `/render`
  ready/function/minRevision contract; the fake renderer stays in test fixtures.
  SDK clients exercise every tool over both transports, including actual file
  changes, six terrain operations and GLB export/rejection. Installed Edge produced
  the montage PNG. Browser execution also validates core modelling/PNG/GLB/compiler.
  Full Windows suite reached 78 passing tests, with typecheck and lint passing.
- M6: self-contained glTF 2.0 export with shared module meshes, hierarchy,
  materials/textures and namespaced collider/marker extras, documented in
  `docs/export-format.md`. Export rejects violations and missing/oversized models
  even when called directly on an unchecked compilation, and generates foundation
  geometry. Unity UPM importer depends on UnityGLTF 2.21.0 and uses a ScriptableObject
  marker mapping. **Actual Unity 6.0.75f1 batchmode passed** for the end-to-end
  three-house village: 40 mesh colliders, 2 markers, mapped spawn prefab and trigger.
  Reproduce with `scripts/test-unity.ps1 -GlbPath <village.glb>`. Local evidence:
  `.cache/unity/project/mapedit-verification.json` and `mapedit-import.log`.
- M7: `mapedit init` safely creates seven model types, a complete example house,
  spawn/trigger markers, PNG terrain, English AGENTS/skill instructions, Claude Code
  and Codex HTTP/stdio configs. Existing files and symlink/junction paths are checked
  before writing. `scripts/e2e.mjs` uses the real CLI to initialize, author three
  houses (including 15/30-degree rotations), a mountain and a road, check zero
  violations, and export a self-contained 5 MB GLB. Final Windows acceptance:
  **94 tests across 16 test files**, `pnpm typecheck`, `pnpm lint`, `pnpm e2e` and
  the Unity batchmode test all passed. Final audit added JSON-safe marker properties,
  locale-independent ordering, exact project/process stdio discovery, concurrent
  terrain transactions, and map IDs independent of their source-directory names.

## 自行決定的事

- Work is split across independent package owners; milestone commits remain ordered.
- CI covers Node 22 and 24 on Windows and Ubuntu; the minimum is Node 22.13 for permission support.
- Tests run without `packages/web`; the real frontend is owned by Claude.
- Socket direction supports up/down plus the four compass directions. Attachments
  infer orientation; structures connect through `structure/instance.socket` paths.
- Height PNGs use signed offset encoding (`sample = meters * 2 + 32768`); absent
  terrain PNGs represent flat ground. Both files are required once either exists.
- Untrusted model code executes in QuickJS WASM inside a permission-restricted
  disposable Node child. Node permissions alone are not treated as a sandbox.
- `canFloat` modules can support attached/stacked modules, allowing floating
  platforms. Foundations support skirt or pillar geometry; both clip to terrain.
- Terrain gentler than one meter blends neighboring corner heights; larger height
  changes retain plateaus and receive cliff faces. Commands select tile centers.
- Model builds run at most four children concurrently. A pure cached build path
  handles previews without scanning disk, rereading models or re-encoding terrain.
  Applying an edit always refreshes from disk first, preserving concurrent Agent edits.
  CI runs test files serially so performance checks do not compete with browser
  launches or the million-tile terrain test; performance thresholds are unchanged.
- The export core is introduced with the MCP export tool; M6 adds the formal
  engine contract and Unity adapter. Exports independently rerun geometry checks.
- Explicit structure height takes precedence over per-module terrain following.
- Undo/redo history is per running project server and includes source/PNG/model
  changes. Git remains the durable authoring history across server restarts.
- Generated MCP stdio configs use the actual installed Node and CLI paths to avoid
  Windows `npx` launch differences; regenerate/update paths if the installation moves.

## 偏離設計

No required backend milestone was skipped. QuickJS supplements Node permissions
because Node's permission model alone is not an untrusted-code sandbox. The sample
render page exists only under server test fixtures, as requested.

## 需要人處理

None. GitHub authentication, system Edge and licensed Unity 6 were available.

## 需要前端配合

- Implement protocol v1 and `/render` exactly as documented; rendering waits for
  `minRevision` and returns a montage PNG. The server serves `packages/web/dist`
  automatically when it exists.
- Module URLs contain local-space GLBs; terrain/generated URLs contain map-space
  GLBs. Both snapshot transforms and glTF matrices are column-major.
- Bundle browser core consumers with `node:*` external and serve manifold.wasm
  adjacent to the bundle; this is exercised by the real Edge browser test.
- Complete the planned real Claude Code/Codex prompt-to-village and Unity Play
  acceptance after the frontend exists. Backend tests deliberately use no AI.

## 已知問題

- No known backend implementation blocker remains. Real screenshots from the
  product frontend are pending that separately owned frontend; the complete
  screenshot transport/render contract has passed using the test renderer.
- UnityGLTF emits optional URP/VisualScripting assembly-reference warnings in the
  minimal built-in-renderer test project; compilation and actual import pass.

## 審查修正

F1–F16 are tracked in order here. Each completed entry records the implementation,
test location and any deviation. Final Windows and GitHub CI acceptance will be
recorded after all corrections are complete.

- **F1 complete:** violation IDs use sorted object refs and stable rule/field
  discriminators, excluding revision, source line and measured values. Drag
  comparison uses IDs while still rejecting violations affecting the moved object
  or newly unsupported neighbors. Updated protocol type comments. Red/green
  regressions: `server/test/drag-violations.test.ts` (both reported failures and
  lost support), `core/test/violation-identity.test.ts` (field uniqueness and order
  independence). Six related test files / 51 tests, typecheck and scoped lint pass.
  Deviation: none.
