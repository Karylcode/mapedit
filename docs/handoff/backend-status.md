# Backend implementation status

**Fourth review round (start here):** the user decided to wrap up this round
before merging.
- **Done:** F38–F42 from `docs/handoff/backend-fixes-4.md` and the added F44,
  one numbered commit each.
- **Cancelled:** F43, by the user's decision. Its unfinished performance test
  is kept only in the local stash, not pushed.

The 第四輪修正 section at the end lists each change, its tests and the
cancellation. Every protocol.md change is an addition or a requested
correction, and `protocolVersion` stays 1:
- the `estimated` wording (F38);
- `HistoryEntry.mapId` and `maps` (F39);
- `unknown_map` for an open map that was deleted (F40);
- flow 10's promise that a failed edit leaves files and history unchanged
  (F42).

The 編輯器前端 session was notified.

**Third review round:** F27–F37 from `docs/handoff/backend-fixes-3.md`
are fixed on the `backend` branch, one numbered commit each, with follow-ups for
F30 (a map whose map.yaml is broken still opens) and F33 (lint ignores the copied
editor build), plus the frontend requests FE13/FE22 and a copy of the frontend's
FE18 wording for `Edit.position`. The 第三輪修正 section at the end lists each
change and its tests. Every protocol.md change is an addition and
`protocolVersion` stays 1:
- `failure` codes and flow 9 (file errors);
- flow 10 (one answer per request) and `unknown_map`;
- overlap `estimated`;
- `HistoryEntry.action` and `refs`, and `MapInfo.kind`;
- notice `mapId` and the scene-before-notice order.

The 編輯器前端 session was notified and has finished FE17 on these fields. The
F33 packed-CLI acceptance with the real editor waits for PR #2, and the F17 real
Claude Code check remains under 需要人處理.

**Second review round:** F17–F26 and F23b from
`docs/handoff/backend-fixes-2.md` are fixed on the `backend` branch, one numbered
commit each (F22 also has a guide follow-up), plus three requests from the
編輯器前端 session (non-metallic terrain, sun and point-marker directions,
screenshots without a GPU). The 第二輪修正 section at the end lists each change
and its tests. Protocol changes are additions only: section 3 gained the
violation params table (F23) and section 4 the stale-ref and disconnect rules
(F21); `protocolVersion` stays 1. Things only a person can do are under
需要人處理, notably the real Claude Code check for F17 (the CLI login on this
machine has expired). Test, CI and push results are recorded in 目前進度.

**Review entry point for Claude (first round):** M0–M7 backend implementation and all F1–F16
review corrections in `docs/handoff/backend-fixes.md` are complete and published on
the same `backend` branch and PR. See the numbered review correction log below.
Start with `docs/protocol.md`, `docs/map-format.md`,
`docs/model-api.md` and `docs/export-format.md`; the executable boundaries are
`packages/core/src/index.ts`, `packages/server/src/index.ts` and the CLI.
Protocol stays at version 1, with stable diagnostic IDs, source metadata and the
documented mock trigger endpoint. `packages/web` has not been created or modified.
The mock remains available through `mapedit dev --mock`.
On this Windows machine: all 265 tests across 43 files, strict build/typecheck and
ESLint pass. The fresh no-AI village has zero violations/file errors and exports a
5,062,524-byte GLB; real Unity 6 batchmode under PowerShell 5.1 verifies 40
MeshColliders, two markers, the spawn prefab and trigger. Frontend rendering and the
two-agent/Unity Play experience remain the planned joint acceptance after the
frontend exists. GitHub publication and CI status are recorded below.

## 目前進度

Fourth round: F38–F42 and F44 are complete on `backend`, one numbered commit per
item, each with a test that failed before the change. F43 was cancelled when the
user decided to wrap up. On this Windows machine `pnpm build`, `pnpm lint`,
`pnpm typecheck` and `pnpm e2e` pass. `pnpm test` passes all 380 tests in 63
files; one earlier run hit the known Node 24 worker abort and passed when rerun.
PR #1's first Windows CI run failed because the runner's temp folder has a short
8.3 name; the F40 entry below describes the fix.
The fresh no-AI village still has zero violations and file errors and exports a
5,062,564-byte GLB.

Third round: F27–F37 are complete on `backend`, one numbered commit per item, and
every bug fix has a test that failed before the change. The exception is the F36
performance test: it measures cost that F20 did not cover, and it already passed
before (0.33 s). On this Windows machine `pnpm build`, `pnpm lint`,
`pnpm typecheck` and `pnpm e2e` pass. `pnpm test` passes all 362 tests in
60 files; see 已知問題 for the intermittent Node 24 worker abort, which did not
occur in the final runs. The fresh no-AI village still has zero violations and
file errors and exports a 5,062,564-byte GLB. Push and CI results for this round
are recorded at the end of 第三輪修正.

Second round: F17–F26 and F23b are complete on `backend`, one numbered commit per
item. Every behavior change has a test that failed before the change; the
refactoring items (F24–F26) add tests that guard the new structure. On this Windows machine
`pnpm build`, `pnpm lint`, `pnpm typecheck` and `pnpm e2e` pass, and `pnpm test`
passes all 313 tests in 53 files (see 已知問題 for the intermittent Node 24
worker abort, which also affects the earlier commit). The fresh no-AI village
still has zero violations and file errors and exports a 5,062,564-byte GLB.

First round: M0–M7 and F1–F16 are complete, with regression tests before bug fixes and numbered
commits. Full Windows validation passes, including real browser execution,
HTTP/stdio MCP paging, isolated packed CLI installation, PowerShell 5.1, the
unchanged 30 ms preview target and the 2-second/2,000-module geometry target.
[PR #1](https://github.com/Karylcode/mapedit/pull/1) is open against `main`.
The branch is pushed. Implementation commit `111d8f3` passes all four
Windows/Ubuntu and Node 22/24 combinations in both the
[PR acceptance run](https://github.com/Karylcode/mapedit/actions/runs/37229561365)
and [branch acceptance run](https://github.com/Karylcode/mapedit/actions/runs/37229558586).
Windows runs all 265 tests; Ubuntu runs 264 and skips only the Windows PowerShell
5.1 test. The isolated package test now uses the exact frozen dependency graph,
the repository's actual store and an empty registry metadata cache. CI-discovered
version/store drift and the external PowerShell process deadline are covered by
the follow-up evidence under F12/F14. Current checks are available on PR #1.
The earlier M0–M7 counts below are historical milestone results.

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
- Second round (details in 第二輪修正): MCP tool schemas have no top-level
  `required`, so required arguments are named in each description and checked at
  run time (F17); `unsupported` advice prefers Socket attachments over lowering a
  single Module (F18); searched advice covers the first 50 geometry violations,
  and solids that fill their bounds use exact box arithmetic (F20); violation
  params add `immovable_object`, and overlap uses `target` instead of the old
  `terrain: true` (F23); `mapedit init` appends `.mapedit/` to an existing
  `.gitignore` (F23b).

## 偏離設計

No required backend milestone was skipped. QuickJS supplements Node permissions
because Node's permission model alone is not an untrusted-code sandbox. The sample
render page exists only under server test fixtures, as requested.

## 需要人處理

Before npm publication, choose the final CLI/dependency package names and scope,
and the npm account that will publish them. All packages remain `private: true`;
this pass validates local tarballs and does not publish. GitHub authentication,
system Edge and licensed Unity 6 were available for local/GitHub acceptance.

F17 real Claude Code check: `claude` 2.1.258 on this machine answers
`Failed to authenticate: OAuth session expired and could not be refreshed`, so
the tool list was not sent to the Anthropic API from here. After signing in again
(`claude` then `/login`), run `mapedit dev` in an initialized project and call:
`claude -p 'Call mcp__mapedit__overview, then mcp__mapedit__query with {"x":10,"z":10}.' --mcp-config <file> --strict-mcp-config --allowedTools "mcp__mapedit__overview,mcp__mapedit__query"`,
where `<file>` contains
`{"mcpServers":{"mapedit":{"type":"http","url":"http://127.0.0.1:4790/mcp"}}}`.
Both calls should complete without an API 400.

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
- Second round (the 編輯器前端 session was notified of each item): stale or
  malformed refs in `previewEdit`/`applyEdit` are answered instead of closing
  the socket, and invalid JSON now closes with 1008 (F21, protocol section 4);
  translate violations with the section 3 params table, `TypedViolationView` and
  `violationParamsProblems` (F23); violation ids now use fixed rule ids (F26);
  `mapeditRender` should throw a readable error when it cannot draw, which the
  backend relays as `Render page error: …`.
- Third round (the 編輯器前端 session was notified on completion of F28, F34 and
  F35 and has implemented FE17 with them):
  - translate edits with `failure` (F28, F30);
  - handle the `unknown_map` notice (F30);
  - show `estimated` overlaps as estimates (F32);
  - read `HistoryEntry.action` and `refs` and `MapInfo.kind` (F34);
  - use a notice's `refs` only when its `mapId` is the open map (F35).

  The editor build keeps its bundles in `static/`, since `/assets/` belongs to
  the backend; packaging copies `packages/web/dist` into the CLI (F33).

## 已知問題

- No known backend implementation blocker remains. Real screenshots from the
  product frontend are pending that separately owned frontend; the complete
  screenshot transport/render contract has passed using the test renderer.
- UnityGLTF emits optional URP/VisualScripting assembly-reference warnings in the
  minimal built-in-renderer test project; compilation and actual import pass.
- Overlaps between solids that are not their own bounding box (openings, or
  Structures rotated off 90°) need one exact Boolean each, about 0.15–0.3 ms per
  pair on this machine. Since F32, solids whose oriented boxes are apart skip it,
  and after 200 exact overlaps in one check the rest are estimated from oriented
  boxes and marked `estimated: true`. Such estimates can report an overlap that
  the exact shapes do not have (for example between diagonal neighbours of round
  Modules) until the first overlaps are fixed and the map is checked again.
- Local `pnpm test` on this machine (Windows, Node 24.15, four Vitest workers)
  sometimes loses one test file: Vitest reports `Worker exited unexpectedly`, and
  the worker's exit code is `3221226505` (`0xC0000409`, a native fail-fast abort)
  with no JavaScript error. It also happens on the commit before this round (2 of
  8 runs) and in roughly 1 of 7 runs now; rerunning passes. This matches the Node
  23+/Windows libuv race `!(handle->flags & UV_HANDLE_CLOSING)` in
  `src\win\async.c` after HTTP/fetch use
  ([nodejs/node#56645](https://github.com/nodejs/node/issues/56645), fix in
  [nodejs/node#61999](https://github.com/nodejs/node/pull/61999)), which other
  projects see on Node 24 but not Node 22. Answering with `Connection: close` did
  not remove it here, so no workaround was kept. CI runs one worker and has not
  shown it.

## 審查修正

F1–F16 are complete. Each entry records the implementation, test location and any
deviation. Final Windows acceptance is recorded after F16; GitHub CI is tracked above.

- **F1 complete:** violation IDs use sorted object refs and stable rule/field
  discriminators, excluding revision, source line and measured values. Drag
  comparison uses IDs while still rejecting violations affecting the moved object
  or newly unsupported neighbors. Updated protocol type comments. Red/green
  regressions: `server/test/drag-violations.test.ts` (both reported failures and
  lost support), `core/test/violation-identity.test.ts` (field uniqueness and order
  independence). Six related test files / 51 tests, typecheck and scoped lint pass.
  Deviation: none.
- **F2 complete:** marker moves preserve terrain-relative height, including a box's
  bottom clearance and point markers. Repeated moves use the latest saved position.
  `core/test/marker-move.test.ts` reproduces both reported box cases, elevated
  points and repeated moves; all pass after the fix. Marker/authoring/disk/drag
  suites (25 tests), typecheck and lint pass. Grid clarification: final height is
  rounded to 0.5 m, so sloped terrain can introduce up to 0.25 m clearance error;
  documented in `map-format.md` and covered by a test. No other deviation.
- **F3 complete:** CLI `check` and MCP `check`/`overview` cover all maps by default;
  CLI JSON always has a `maps` array. All-map export validates and prepares every
  GLB before writing, names rejected maps/source errors, and preserves existing
  outputs on rejection. Explicit map selection retains the same report shape;
  MCP reporting leaves the editor's selected map unchanged. Red/green regressions
  in `cli/test/multi-map.test.ts` and `server/test/multi-map-mcp.test.ts` cover the
  second-map violation, all-map exports, malformed maps and selection isolation.
  README, format docs, Agent template and the end-to-end script are updated.
  Deviation: none.
- **F4 complete:** a shared `listFloatingInstances` report lists every `canFloat`
  instance with ref, module type and map-space model-origin position, including
  grounded instances. CLI text/JSON and both MCP reports use it; it does not affect
  violations or exit status. `core/test/report.test.ts`, the CLI multi-map test
  and MCP multi-map test exercise floating islands supporting ordinary houses,
  grounded exceptions and paging. ADR 0011 behavior is preserved. Related CLI,
  MCP, geometry-report and history tests, typecheck and lint pass. Deviation: none.
- **F5 complete:** every violation kind now supplies concrete corrections: nearest
  legal values/angles, minimum boundary moves, closest existing names and accepted
  socket types. Geometric diagnostics include locations; exact solid searches find
  shortest cardinal half-meter moves up to 5 m and downward support up to 3 m,
  then compatible supported free sockets or intentional `canFloat` guidance.
  Searches cover whole merged structures, reuse a spatial index and candidate cache,
  and exclude unsupported support cycles. Advice states when it is evaluated at
  the current geometry/height and requests a recheck after terrain placement.
  Red/green tests: `core/test/compiler-suggestions.test.ts` and
  `core/test/suggestions.test.ts`, including openings, explicit terrain-following
  heights and suggestions applied back to the map. Related geometry, compiler,
  dragging and server tests pass; 30 ms preview and 2-second/2,000-module bounds
  remain passing. Deviation: none.
- **F6 complete:** CLI text diagnostics prepend `file:line: kind:` and keep the
  message plus suggestion. Core diagnostics already carry authoritative source
  metadata, preserved by MCP. `cli/test/diagnostics.test.ts` reproduces the missing
  prefix before the fix; the MCP multi-map test checks the exact file and line.
  Five related CLI/MCP tests, typecheck and scoped lint pass. Deviation: none.
- **F7 complete:** `templates/authoring.md` is the single English source for both
  complete Agent guides. `scripts/generate-authoring.mjs` generates `AGENTS.md`
  and skill frontmatter plus the identical body; build runs the generator and
  `--check` verifies freshness. Both contain the workflow, full authoring format
  and common errors without delegating fundamentals to another document.
  `cli/test/agent-docs.test.ts` first reproduced the incomplete guide, then checks
  all sections, canonical equality and initialized copies. Eight documentation,
  init and end-to-end tests, build, lint and formatting pass. Deviation: none.
- **F8 complete:** the fixed mock snapshot contains all seven violation kinds,
  actionable source/spatial diagnostics, foundation geometry, point and box
  markers, and file errors. Its public POST trigger exercises all five notices
  through real state/history changes, with a 16 KiB body limit; real servers do
  not expose it. `server/test/mock-coverage.test.ts` first reproduced the missing
  coverage, then verifies assets, notices, snapshots, invalid requests and route
  isolation. Mock, protocol, MCP and real-server suites (24 tests), typecheck and
  scoped lint pass. Deviation: none.
- **F9 complete:** project parsing rejects every `materials` declaration, including
  empty and null values, with a source-located format error explaining the version
  1 built-in-only policy. Format documentation no longer promises custom materials.
  `core/test/material-policy.test.ts` reproduces all three invalid declarations
  and verifies built-in material authoring. All 41 related parsing/compiler tests,
  typecheck and scoped lint pass. Deviation: none.
- **F10 complete:** compiler Socket placement uses `PlacedSocket`, `targetSocket`
  and `localSocket`; its composed map transform is named `mapTransform`. The
  identifier audit preserves protocol `SceneSnapshot` and notice `level` fields,
  and external GLTF/math terminology. `core/test/terminology.test.ts` checks the
  actual TypeScript identifiers; 38 terminology/compiler/golden tests, typecheck
  and scoped lint pass. Deviation: none.
- **F11 complete:** all MCP tool text, including schema/runtime errors and module
  build summaries, passes through a common 24,000-character response boundary.
  Oversized results return exact text fragments with same-tool cursor continuation;
  continuation reads a captured result and never repeats mutations. Images remain
  on the first page without structured content. Captures have five-minute expiry,
  a 64-entry LRU limit and an 8 MiB aggregate budget, retaining a single larger
  result when needed to keep it pageable. The 10,000-element input guard remains.
  `server/test/mcp-paging.test.ts` first reproduced discarded/oversized results,
  then covers all ten tools, escaping, errors, schemas, expiry, isolation, HTTP and
  stdio continuations, and mutation counts. All 47 related MCP/server/guide tests,
  typecheck, scoped lint and generated-guide freshness checks pass. The shared
  authoring guide documents continuation and expiry. Deviation: none.
- **F12 complete:** CLI initialization reads package-local templates. Build,
  typecheck and CLI prepack generate the shared guides and copy the complete
  template tree; identical outputs are left untouched for concurrent readers.
  Explicit package file lists include all four compiled runtimes, core materials
  and CLI templates. `cli/test/packed-cli.test.ts` executes
  `scripts/test-packed-cli.mjs`: four actual `pnpm pack` tarballs are installed
  offline into a temporary consumer outside the repository using local overrides,
  with package and dependency realpaths checked to exclude repository links.
  The installed CLI initializes a project and checks its model/terrain/textures
  with zero errors. The regression first failed because dependency runtimes were
  absent; tarball inspection also confirmed missing templates. The packed test,
  preparation nonmutation test, init, guide and end-to-end tests (10 tests),
  typecheck and lint pass. All packages remain private; npm naming/scope and
  account selection are recorded under human follow-up. Deviation: none.
  CI follow-up: the consumer now preserves the repository's exact external
  dependency/peer/optional snapshots and installs with `--offline --frozen-lockfile`.
  Only the four workspace roots become actual tarball nodes with SHA-512 integrity;
  packed manifests are checked against source declarations and locked importers.
  An empty registry metadata cache first reproduced the unlocked install failure,
  then passed without resolving any ranges. `cli/test/packed-lockfile.test.ts`
  covers graph preservation and omitted/added/changed declarations or stale edges.
  All 15 related tests pass, followed by all 265 Windows tests across 43 files.
  The harness also pins the store recorded by the repository installation, because
  GitHub's Windows checkout and temporary consumer use different drives and pnpm
  otherwise chooses different stores. The actual packed test overrides the default
  with an empty store to reproduce that failure and verifies the selected store
  before and after installation; registry metadata remains empty and offline.
- **F13 complete:** the disposable model worker is an ordinary TypeScript entry
  point covered by strict compilation and ESLint, with shared typed stdin/stdout
  messages. The runner resolves the installed server package's compiled worker,
  launches its file directly and retains Node permissions, QuickJS isolation,
  memory limits and the parent timeout. No executable bootstrap string or Node
  `--eval` remains. `server/test/model-worker.test.ts` first failed for direct
  worker execution and the string bootstrap, then passed from an unrelated working
  directory. Existing model execution/security tests and actual packed CLI
  initialization/check acceptance pass (6 tests); typecheck and scoped lint pass.
  Deviation: none.
- **F14 complete:** Unity verification updates JSON object properties with
  PowerShell 5.1-compatible commands and explicit UTF-8 input/output, preserving
  unrelated dependencies, scoped registries and Unicode. Both the actual script
  and `cli/test/unity-script.test.ts` first reproduced the unsupported
  `-AsHashtable` parameter under Windows PowerShell 5.1, then passed after the
  fix. The automated test simulates only Unity process launch; real Unity 6 also
  imported an existing GLB under 5.1 and verified 24 MeshColliders, two markers,
  the spawn prefab and trigger. Scoped lint passes. Final fresh-village acceptance
  follows after F16. Deviation: none.
  CI follow-up: one hosted PowerShell process hit the original 15-second deadline
  while the equivalent job passed. The external shell test now has a bounded
  60-second process deadline and reports phase markers, elapsed time and exit
  details on failure. Map preview/compiler performance thresholds are unchanged.
- **F15 complete:** protocol helpers now construct/parse ObjectRefs and validate
  identifiers; compiler, editing, exporting, mock and MCP consumers use them.
  Unused Module definitions report empty object refs plus `params.moduleType`
  and stable per-definition diagnostic rules. MCP Structure arguments normalize
  centrally; typed terrain schemas use the Surface catalog, while Material IDs
  derive only from the built-in Material definitions. Matrix and symmetric Socket
  compatibility logic are shared with core. Project identity, input walking,
  path containment, history and notice construction now have single implementations.
  The model worker's package read roots include the new protocol runtime dependency.
  Memory history IDs remain monotonic after branching, malformed wire refs are
  rejected, and stale deletes do not create history; merged source refs still work.
  Regressions live in `protocol/test/object-ref.test.ts`,
  `core/test/shared-references.test.ts`, `server/test/mcp-inputs.test.ts`,
  `project-inputs.test.ts`, `state-consistency.test.ts` and the protocol suite.
  The final combined F15 run passes 76 tests across nine suites, typecheck and
  workspace lint; related compiler, geometry, paging, model and CLI checks also
  pass. Path/link isolation and unchanged input Buffer reuse are verified.
  Deviation: none; paint uses Surface IDs, not Material IDs, as required by the
  terrain domain model.
- **F16 complete:** all compiler, geometry and synthetic mock/preview diagnostics
  use the object-parameter `createViolation` factory, retaining stable rules and
  metadata precedence. `markerPosition` supplies point/box coordinates everywhere.
  Both StateStore implementations provide required scene/asset methods and their
  own Agent service factory; explicit mock capability replaces class checks.
  The compiler check functions and MCP footprint/raster names are descriptive;
  the `ProjectBuild` alias and unused `writeAgentFiles` method are removed.
  Tests: `core/test/violation-factory.test.ts`,
  `protocol/test/marker-position.test.ts`, `server/test/state-contract.test.ts`,
  plus existing compiler, geometry, marker, protocol, MCP and disk regressions.
  Opaque state factory/capability failures were reproduced before fixing them.
  All final Windows checks pass: 265 tests across 43 files, build, workspace lint,
  generated guide checks and scoped formatting. Deviation: none.

Final correction acceptance: `pnpm build`, `pnpm lint` and `pnpm test` pass with
no skipped Windows tests. The suite includes real Edge/browser core execution,
model isolation, all-map checking/export, MCP pagination, package installation
outside the repository, and actual Windows PowerShell 5.1 JSON behavior.
`scripts/e2e.mjs .cache/acceptance/review-village-final` generated three structures
and 24 modules with zero violations/file errors. The exported GLB passed real
Unity 6000.0.75f1 import through `scripts/test-unity.ps1`: 40 MeshColliders, two
markers, spawn prefab and trigger. Independent F1–F16 checklist review found no
remaining actionable requirement gap. npm publication remains the explicit human
follow-up above; frontend/joint acceptance remains separately owned.

## 第二輪修正

F17–F26 from `docs/handoff/backend-fixes-2.md`, fixed on the same `backend` branch
by Claude. Each entry records the change, the tests and any deviation.

- **F17 complete:** every MCP tool now advertises one top-level `type: "object"`
  schema with its original properties plus an optional `cursor`. There is no
  top-level `anyOf`, `oneOf`, `allOf`, `not`, `if`, `then` or `else`, and no
  top-level `required`, because a continuation sends only the cursor. Required
  arguments are named in each tool description (`Required arguments: x, z.`) and
  are still enforced at run time by the original strict Zod schema. A cursor sent
  with other arguments is rejected with an error that names the extra arguments
  and asks for `{"cursor":"..."}` alone. Tests: `server/test/mcp-schema.test.ts` lists the real mock server's tools over HTTP and
  stdio and checks the runtime rules (both tests failed before the fix);
  `server/test/mcp-paging.test.ts` replaces the assertion that locked in `anyOf`.
  Real Codex: Codex CLI 0.160.0 with `gpt-5.5` over HTTP MCP called `overview` and
  `query` and received both results. In `codex exec` the server needs
  `mcp_servers.mapedit.default_tools_approval_mode="approve"`, otherwise tool calls
  are refused for approval. The newer Codex models use code mode, which needs
  `codex-code-mode-host.exe`; it is not installed here, so `gpt-5.5` (direct
  function tools) was used. A control run against the pre-fix server also worked
  in Codex, which means Codex rewrites MCP schemas before calling its API; the
  400 failure is on the Anthropic side. The real Claude Code check is listed under
  需要人處理 because the CLI login on this machine has expired. Deviation: none.
- **F18 complete:** `unsupported` advice now looks for a supporting position in
  this order: lower the whole Structure (F5 behavior); attach to the nearest
  compatible free Socket of a supported Module, including Sockets in the same
  Structure, choosing a placement that is verified clear; lower only this Module
  and the Modules attached to it onto terrain or a supported Module; otherwise
  name the nearest compatible Socket and say that the obstruction must move too.
  `canFloat: true` is suggested only when no compatible supported free Socket is
  within 5 m. Same-Structure advice names the YAML to use, for example
  `Attach roof to wall_n.top (1 m below)` followed by
  `attach: {socket: bottom, to: wall_n.top}` as the replacement for the roof's
  `at` and `rotation`; another Structure gets the matching Structure `attach`.
  The compiler's Socket alignment moved into the shared `socketAttachment`
  (`core/src/socket-rules.ts`), so the advice computes
  the attached pose exactly as compilation does; `inverseRigid` moved from export
  to `core/src/math.ts`. Tests: `core/test/suggestions.test.ts` "F18" (the roof
  case, preferring a clear supported Socket over a floating one, an obstructed
  Socket, and lowering one Module onto its Structure); each fix is applied back
  and rechecked. All four failed first with the reported `canFloat` advice. The
  F5 cross-Structure test now expects the exact `attach` text. The rewrite already
  uses the F24 names (`solidsByStructure`, `Placement`, `place`). Deviation: none.
- **F19 complete:** `snapMove` in `core/src/format.ts` is now the single rule for a
  human move: grid X/Z, 15-degree rotation, and the height (a Marker keeps its
  height above terrain, an explicit Structure height stays, anything else sits on
  terrain). `normalizeEdit` and the mock `MemoryState` preview/apply both call it;
  the mock passes its flat terrain at height 0. Dragging the mock box marker from
  center `[10, 1, 5]` to `[30.2, 0, 29.9]` now gives `[30, 1, 30]`, keeping its
  bottom on the ground. The mock also stores rotations normalized to 0–360 like
  the real editor. Test: `server/test/protocol.test.ts` "F19 keeps the bottom
  clearance of a dragged mock box marker" (preview and apply over WebSocket);
  it failed first with `[30, 0, 30]`. Deviation: none.
- **Extra (frontend request) – non-metallic terrain:** the 編輯器前端 session
  reported that terrain chunk materials had no `metallicFactor`, so glTF's
  default of 1 rendered terrain as metal (black in shadow in three.js, metallic in
  Unity). `appendTerrainChunk` now sets `metallicFactor` 0 for every Surface
  material, which covers both the editor chunk GLBs and the exported map GLB.
  Tests: `core/test/terrain.test.ts` "terrain chunk materials" and an added check
  in `core/test/export.test.ts`; both failed first with metallicFactor 1. The
  frontend's temporary override of `surface:*` metalness is no longer needed.
- **F20 complete:** three changes in the geometry check. (1) Only the first 50
  geometry violations, in report order, get a searched suggestion
  (`SEARCHED_ADVICE_LIMIT` in `core/src/geometry.ts`); the others keep a brief
  suggestion ending with "Specific suggestions are searched for the first 50
  geometry violations only; fix those, then run check again." (2) An overlapping
  pair now costs one exact Boolean instead of four: the same intersection gives the
  location, and overlapping Modules are linked for Support directly instead of
  running two downward probes; probes are also skipped when the bounds only share
  a face. (3) A placed solid whose volume equals its axis-aligned bounds is exactly
  that box (`PlacedSolid.box`), so two such solids use box arithmetic, which gives
  the same answer as the Boolean. Shapes with openings and Structures rotated off
  90° still use exact Booleans. The shared solid helpers live in
  `core/src/solid.ts`. Measured on this machine for 2,000 box Modules spaced
  1.5 m (7,732 overlaps), compile plus check: 8.2 s before, 0.35 s after; 2,000
  floating Modules 0.2 s. Without the box shortcut but with (1) and (2): box grid
  0.9 s, door-model grid 1.35 s, 15°-rotated grid 1.07 s, and 30°-rotated door
  models spaced 1.0 m (15,286 overlaps) 4.3 s, because every non-box overlap still
  needs one exact Boolean (about 0.15–0.3 ms each). Tests:
  `core/test/geometry.test.ts` "F20" (2,000 densely overlapping Modules with brief
  advice after the first 50, and 2,000 floating, partly overlapping Modules, both
  under 2 s; the first took 8 s before the fix) and `core/test/solid.test.ts`
  (box detection, box arithmetic equal to the Boolean result for overlap, contact
  and separation, and box tracking through moves). Deviation: none.
- **Extra (frontend request) – sun and point-marker directions:** the frontend
  defined in `docs/protocol.md` section 2 (frontend branch, commit `5169f13`)
  that `sun.azimuth` is measured clockwise from north viewed from above (0 north
  −Z, 90 east +X, 180 south +Z) and that a point marker faces south (+Z, glTF
  forward) at rotation 0. `docs/map-format.md` and the generated Agent guide
  (`templates/authoring.md`, `AGENTS.md`, `SKILL.md`) now say the same. The
  backend already matched: it passes `sun` through unchanged, exports marker
  rotation as the glTF node rotation around +Y, and the Unity importer places
  the mapped prefab at local identity under that node, so a spawn prefab faces
  glTF forward (+Z) at rotation 0. No code change was needed.
- **F21 complete:** `docs/protocol.md` section 4 gained two rules (additions
  only): a `previewEdit` or `applyEdit` whose `edit.ref` is malformed or names a
  missing object keeps the connection open and gets `previewResult { ok: false }`
  with exactly one `missing_reference` (its `refs` is the received ref), or
  `editResult { ok: false, reason }` plus an `edit_rejected` notice, with files and
  history unchanged; only structurally invalid messages close with 1008 (not JSON,
  unknown `type`, wrong field types, or messages before `hello`/`openMap`).
  `validEdit` in `server/src/index.ts` now checks only that `ref` is a string;
  invalid JSON now closes with 1008 instead of producing a `file_error` notice.
  Both states answer stale refs: the mock returns one `missing_reference` early,
  and the real state resolves the edit inside its error handling so nothing
  escapes to the socket. Tests: `server/test/ws-references.test.ts` runs the same
  cases against the mock and a real project (six malformed or missing refs for
  move and delete, four structurally invalid messages, and a ref removed by an
  Agent rename); the mock and real cases failed first by disconnecting, and
  invalid JSON failed by staying open. The F15 test in
  `server/test/protocol.test.ts` that expected 1008 for malformed refs now expects
  the F21 answer. Deviation: none.
- **F22 complete:** `AgentServices.projectRevision()` reports a counter that grows
  whenever project files change (`DiskState.projectRevision`) or the mock scene
  changes (`scene.revision`). Each captured MCP result stores the revision at the
  time its first page is produced, after any mutation by the tool itself. A
  continuation first runs `flush()` to process pending file changes, then compares
  revisions; on a mismatch the capture is discarded and the call returns
  `Results changed since the first page. Run the tool again without cursor.`
  Unchanged projects keep continuing from the immutable capture, so F11's
  no-replay guarantee is unchanged. Tests: `server/test/mcp-paging.test.ts` "F22"
  (a real project: first page of `check`, edit a structure file, continuation
  returns the error, which failed first by returning the old page; an unchanged
  real project pages to the end; a pending Agent edit that only the
  continuation's flush processes). The F11 paging tests now also assert that
  every continuation flushed first. Deviation: none.
- **F23 complete:** `docs/protocol.md` section 3 now has a "違規的 params" table
  listing each kind's params with names, types and meanings, plus the
  `OffGridField`, `RotationField` and `MissingReferenceReason` values (additions
  only; `ViolationView.params` stays `Record<string, unknown>`). Shapes chosen
  for translation: `off_grid {field, values, nearest, moduleType?}`,
  `bad_rotation {field, rotation, step, nearest, moduleType?}`,
  `out_of_bounds {edges: [{edge, distance}], bounds, size}`,
  `missing_reference {reason, reference, moduleType?}`,
  `incompatible_socket {reason, socketA, socketB, typeA, typeB}`,
  `overlap {target: 'module' | 'terrain'}` (replacing the undocumented
  `terrain: true`) and `unsupported {}`; file-backed violations add `file` and
  `line`. `packages/protocol` exports `ViolationParamsByKind`,
  `TypedViolationView` and `violationParamsProblems()`, a strict checker that also
  reports undocumented keys. `createViolation` in core now requires exactly the
  documented params for its kind at compile time, so every compiler, geometry,
  editor-preview and mock producer was updated; `exceededMapEdges` computes the
  edges for both the compiler and the mock. The mock scene's socket example now
  uses roof and stair, which really are incompatible. Tests:
  `core/test/violation-params.test.ts` compiles projects that produce every kind,
  field and reason and checks each violation with the checker (failed first on
  missing `field`/`target`); `server/test/violation-params.test.ts` checks the
  mock scene, mock previews and real editor previews (all three failed against
  the previous producers). `server/test/build-project.test.ts` now reads
  `params.target`. Deviation: none; `immovable_object` was added to the reasons for
  editor previews that try to move a Module or an attached Structure.
- **F23b complete:** the repository `.gitignore` ignores `.mapedit/`. The project
  template ships `templates/project/gitignore` (stored without the dot because
  package managers drop `.gitignore` files from tarballs) and `mapedit init`
  writes it as `.gitignore` containing `.mapedit/`. When the target folder
  already has a `.gitignore`, init keeps it and appends only the missing rule
  (matching its line endings) instead of refusing, which is what it does for
  every other existing file. Tests: `cli/test/init.test.ts` "F23b" (new project
  and this repository; existing file with and without the rule), and the packed
  CLI acceptance in `scripts/test-packed-cli.mjs` now asserts the installed CLI
  creates the `.gitignore`. The first test failed before the change. Deviation:
  none.
- **F24 complete:** `groups`, `Candidate`/`candidate()` and the
  `SolidInstance = AdviceSolid` alias were already replaced in F18 and F20
  (`solidsByStructure`, `Placement`/`place()`, one shared `PlacedSolid` type in
  `core/src/solid.ts`); the compiler's unexplained `positive` flag became the
  `minimum` option of `checkGridAlignment` in F23, and the bounds advice now
  names its directions `forward`/`backward`. This commit renames the pager's
  `bound()`/`continue()` to `firstPage()`/`nextPage()`, calls Modules "modules"
  in the mock messages, and says "map-space" in `docs/map-format.md`. Tests:
  `core/test/terminology.test.ts` and `server/test/terminology.test.ts` "F24"
  check the identifiers, mock messages and wording; all four failed before the
  renames. Deviation: none.
- **F25 complete:** each duplicate now has one implementation.
  `sceneHasProblems` (`core/src/report.ts`) decides whether a map has violations
  or file errors for export, the CLI exit code, `exportProject` and MCP `ok`.
  `selectedMapIds` (`server/src/build-project.ts`) chooses the maps for
  `buildProjects` and the MCP `getScenes`. Path containment lives only in
  `server/src/paths.ts`: `scripts/test-packed-cli.mjs` imports the built
  `containsPath` (that script already needs a build), and the check in
  `scripts/prepare-cli.mjs` was removed because its destination is a fixed
  folder inside the CLI package and could never fail. The compiler's three Socket
  address lists use one `socketAddresses` helper. In geometry, `bucketKeys`
  serves both the pair search and `nearby`, the overlap test is the shared
  `overlapLocation` (F20), and `supportedFrom` (`core/src/support.ts`) is the
  single Support search used by the check and the advice. `NOTICE_CODES` in
  `packages/protocol` defines `NoticeCode` and drives `parseMockNotice`, and
  `TERRAIN_HEIGHT_RANGE` in `core/src/terrain.ts` bounds both the PNG encoding
  and the MCP terrain schema. Tests: `core/test/shared-helpers.test.ts` and
  `server/test/shared-helpers.test.ts` cover the new helpers; existing compiler,
  geometry, CLI, MCP, mock and packed-CLI tests cover the call sites (all 304
  tests pass). Deviation: none.
- **F26 complete:** (1) The brief geometry suggestions set when overlap,
  terrain-overlap and unsupported violations are created are no longer dead
  code: since F20 they are what violations after the first 50 keep, so they stay
  (the F20 test asserts them). (2) Violation ids no longer use display labels:
  grid and rotation rules are the fixed `field` ids from F23 (for example
  `structure_position`), and Module definition rules are
  `definition:<module>:size`, `:material`, and `:socket:<socket>:position`,
  `:rotation` or `:type`, whether or not the Module is used. (3) The material
  rule no longer looks like an ObjectRef (`module:<id>:material` became
  `definition:<id>:material`). (4) `triggerMockNotice` left the shared
  `StateStore`; the mock implements the separate `MockNoticeTrigger`, and the
  server enables `/api/mock/trigger` only in mock mode for a state that passes
  `canTriggerMockNotices`. (5) Undo and redo live in `ProjectHistory.travel()`,
  which moves the now read-only `cursor` only after the state's restore callback
  succeeds; both states pass their own restore step. (6) Suggestion text moved
  from `compiler.ts` into `core/src/compiler-suggestions.ts`
  (`createCompilerAdvice`), mirroring the geometry advice; the compiler keeps
  compilation and violation identity. Tests: `core/test/violation-identity.test.ts`
  "F26" (fixed rule ids, none label-like or ObjectRef-like),
  `server/test/history.test.ts` (cursor moves after restore, failed restore keeps
  it, cursor cannot be assigned, `StateStore` lacks `triggerMockNotice`) and
  `core/test/terminology.test.ts` "F26" (every compiler suggestion comes from
  the advice module); each failed before its change. Existing suggestion and
  golden tests confirm the text is unchanged, and the F15 identity test now
  expects the fixed rule. Deviation: item (1) keeps the lines because F20 made
  them live.
- **Extra (frontend request) – screenshots without a GPU:** the headless browser
  now starts with `SCREENSHOT_BROWSER_ARGS` =
  `--disable-dev-shm-usage --enable-unsafe-swiftshader` (`server/src/screenshot.ts`),
  so the three.js `/render` page can fall back to software WebGL on machines
  without a GPU, such as GitHub's Ubuntu runner; with a GPU nothing changes.
  When `mapeditRender` throws (the frontend reports missing WebGL or an unknown
  map that way instead of hanging), the screenshot error is the page's own
  message after `Render page error:`, without Playwright's prefix and stack.
  Tests:
  `server/test/screenshot.test.ts` (the flag, the relayed page error, and a real
  WebGL2 context in the headless render page, which also runs on CI); the first
  two failed before the change.

## 第三輪修正

F27–F37 from `docs/handoff/backend-fixes-3.md`, fixed on the same `backend` branch.

- **F27 complete:** `unsupported` advice now offers every compatible free Socket
  in the Module's own Structure, at any distance and whether or not that Socket's
  Module has Support yet; when it does not, the advice adds that the target needs
  Support first. Sockets in other Structures still have to be supported and
  within 5 m, because that attachment moves and merges a whole Structure.
  `canFloat` is suggested only when neither kind exists. Tests:
  `core/test/suggestions.test.ts` "F27": (a) a house with `height: 2` whose roof
  floats 1 m above `wall_n.top` (the wall is told to lower the house, the roof to
  attach to `wall_n.top` and that `wall_n` needs Support), and (b) a roof 6 m
  above a compatible Socket of its Structure; both returned the `canFloat` advice
  before the change. Deviation: none.
- **Extra (frontend requests FE13, FE22) – shared catalogs:** `packages/protocol`
  exports `VIOLATION_KINDS` and derives `ViolationKind` from it, like
  `NOTICE_CODES`; the server package re-exports `findBrowser` and
  `SCREENSHOT_BROWSER_ARGS` so the frontend browser tests launch the same system
  browser with the same flags as `ScreenshotService`. Exports only, no behavior
  change. Tests: `protocol/test/catalogs.test.ts` and the export check in
  `server/test/screenshot.test.ts`.
- **F28 complete:** `docs/protocol.md` section 4 adds an optional `failure` code
  to `previewResult` and `editResult` (`EditFailure`: `violations`,
  `unknown_object`, `immovable_object`, `file_errors`, `nothing_to_undo`,
  `nothing_to_redo`, `internal_error`) and flow 9: while any project file is
  unreadable, moves answer `failure: 'file_errors'` with no violations, and
  deletes stay allowed. Section 3 states that `immovable_object` is only for a
  Module inside a Structure or an attached Structure. `packages/protocol` exports
  `EDIT_FAILURES`/`EditFailure`. Core's `applySourceEdit` throws `EditError`
  with its failure code, so the server tells a stale ref, an immovable object
  and file errors apart instead of guessing from `sourceRefs`; other exceptions
  propagate (F30 answers them). `StateStore.apply`/`travel` return
  `{ reason, failure }`, `ProjectHistory.travel` returns `nothing_to_undo` or
  `nothing_to_redo`, and both the real and mock states send the codes. Tests:
  `server/test/edit-failures.test.ts` previews and applies a valid Structure
  while another structure file, a module.yaml, a model.ts or another map is
  broken (all four answered `immovable_object` with the YAML error before), and
  checks `immovable_object`, `unknown_object` and `violations` codes; updated
  expectations in the disk-state, drag, consistency and history tests.
  Deviation: none.
- **F29 complete:** `compileMap` builds `sourceRefs` as a null-prototype record
  and the server's delete preview checks it with `Object.hasOwn`, so names on
  `Object.prototype` are never existing objects. Moves already went through
  `applySourceEdit`, which finds objects in arrays and, since F28, reports
  `unknown_object`. The other lookups by client or Agent strings were checked:
  `parsed.modules`, `parsed.maps`, `socketTypes` and `markerTypes` were already
  null-prototype, MCP tools and paging cursors use `Map`, and the mock state
  searches arrays. Tests: `server/test/prototype-names.test.ts` previews and
  applies delete and move for `constructor`, `__proto__`, `toString`,
  `hasOwnProperty` and `valueOf` over a real WebSocket (delete previews answered
  `ok: true` before), runs MCP `build_module` with those names, compiles them as
  map ids and as a Module type, and checks that `sourceRefs` has no prototype.
  Deviation: none.
- **F30 complete:** `docs/protocol.md` section 4 adds flow 10: every
  `previewEdit`, `applyEdit`, `undo` and `redo` gets exactly one answer with its
  `requestId`; an unexpected error (for example EBUSY while the Agent writes)
  answers `previewResult { ok: false, failure: 'internal_error', violations: [] }`
  or `editResult { ok: false, failure: 'internal_error', reason }`. The WebSocket
  handler remembers the request until its answer is sent, so a later failure
  (for example while broadcasting) never sends a second answer; messages
  without a `requestId` still get a `file_error` notice. Flow 2 and the
  NoticeCode list add `unknown_map`: `openMap` for an id that is not a project
  map is answered with `notice { level: 'error', code: 'unknown_map' }`, the
  connection keeps its open map, and `DiskState.getScene` throws
  `UnknownMapError` instead of building and caching that id. The same error
  makes `GET /api/scene?map=<unknown>` answer 404 and MCP tools with an unknown
  `map` answer a tool error; the mock state and `POST /api/mock/trigger` support
  the new code. A map that was open when the Agent deleted it keeps its cached
  build, so its editors see the "does not exist" file error in the next scene.
  A map whose `map.yaml` cannot be read still counts as a project map (a
  `maps/<id>/map.yaml` that produced no map), so `openMap` and MCP calls show its
  file errors instead of `unknown_map`.
  Tests: `server/test/request-replies.test.ts` makes `getBuild` and `flush`
  reject on a real server and checks one `internal_error` answer per request
  (previews and applies got no answer before), checks the `unknown_map` notice,
  the kept open map and that `builds` never gains the unknown id over
  WebSocket, HTTP and MCP (it was cached before), opens and checks a map with a
  broken `map.yaml` while a directory whose valid `map.yaml` sets another id
  stays unknown, and covers mock mode;
  `server/test/mock-coverage.test.ts` triggers `unknown_map`, and
  `protocol/test/catalogs.test.ts` now compares `VIOLATION_KINDS`,
  `NOTICE_CODES` and `EDIT_FAILURES` with their unions in `docs/protocol.md`.
  Deviation: none.
- **F31 complete:** `ScreenshotService` races the render page's
  `mapeditRender` call against a 60 second limit. When the limit passes, the
  capture fails with "The render page did not finish within 60 seconds and was
  closed…", the `finally` block closes the page (which also ends the pending
  evaluate call), and the browser stays usable for the next capture. The
  limit is a constructor option and `ServerOptions.screenshotTimeoutMs`, so
  tests use 0.5 seconds. Relayed render page errors keep their first line and
  are cut at 1,000 characters with "… (N more characters)". Tests:
  `server/test/screenshot.test.ts` "F31" uses new fixture modes: `hang`
  (`mapeditRender` never resolves while the page holds a request open; the
  capture fails in time, the held request is closed, and a later capture
  works; before, it waited forever), `verbose` (a 20,000-character page error
  is capped), and an MCP `screenshot` call on a real server whose web root is
  the fixture, which answers the timeout error. Deviation: none.
- **F32 complete:** three changes keep dense non-box overlaps within two seconds:
  - Every placed solid also gets an oriented box: its model bounds placed along
    its own axes (the map-axis bounds for a Foundation with an extension). Two
    solids whose oriented boxes are more than 1e-7 m apart cannot meet, so
    `overlapLocation` and `restsOn` skip the Boolean for them. This changes no
    result: a test compares both functions with and without the boxes for
    turned walls that are apart, touching, sunk 0.00005 m into each other,
    crossing and stacked.
  - After `EXACT_OVERLAP_LIMIT` (200) exact overlaps in one check, the
    remaining non-box pairs are estimated from the oriented boxes (box pairs
    stay exact). `docs/protocol.md` section 3 adds the optional overlap param
    `estimated: true`; such a violation says it is "estimated from bounding
    boxes" and asks to fix the first 200 overlaps and check again. Ids do not
    change, because params are not part of them.
  - Suggestion searches for the first 50 violations share a budget of 1,000
    Boolean operations, counted in `overlapLocation` and in terrain contact.
    When it runs out, the remaining violations keep the brief suggestion, whose
    text now says the search is limited.

  Measured on this machine before → after, compile plus check: cylinders
  3.8 s → 0.75 s, door walls turned 30° and 0.5 m apart 3.3 s → 0.4 s, boxes
  with a hole 1.3 s → 0.5 s. Tests: `core/test/geometry.test.ts` "F32" checks
  2,000 densely overlapping cylinders, door walls turned 30° and boxes with a
  hole: each must finish within 2 s, report exact first overlaps and marked
  estimates after them, and give params that `violationParamsProblems`
  accepts. All three failed before the change. `core/test/solid.test.ts`
  "F32" covers the equivalence and that the boxes move with `moveSolid`.
  Deviation: the spec suggested axis-aligned bounds for the estimate; this
  uses oriented boxes because axis-aligned bounds of a turned wall are several
  times larger than the wall.
- **F33 mechanism complete; packed acceptance pending PR #2:**
  - `scripts/prepare-cli.mjs` (run by `pnpm build`, `typecheck` and the CLI's
    `prepack`) now copies `packages/web/dist` into `packages/cli/web` through
    the new `scripts/sync-tree.mjs`. The CLI's `files` list includes `web`
    (gitignored like the templates). An identical copy is left untouched, and
    without a web build the copy is removed so a package never carries an old
    editor.
  - `mapedit dev` and the stdio `mapedit mcp` fallback pass
    `webRoot = findWebRoot(SERVER_WEB_ROOT, <cli>/web)`. The repository's fresh
    `packages/web/dist` (or an installed `@mapedit/web`) comes first, then the
    packed copy, otherwise `null`.
  - `ServerOptions.webRoot` accepts `null` for "no editor". A web root now
    needs an `index.html` to count. `ScreenshotService` receives the same
    `webRoot`; without a built editor, `screenshot` fails at once with "The
    editor web build is missing; run pnpm build." and `build_module` reports it
    as `previewError`. Before, both waited 30 seconds for
    `mapeditRenderReady`.
  - Tests: `server/test/web-root.test.ts` serves a fake editor build at `/`,
    `/render` and `/static/…`; with `webRoot: null` it checks both MCP tools
    answer within seconds (before: a 30 s timeout) and the lookup order of
    `findWebRoot`. `cli/test/package-assets.test.ts` "F33" copies a fake dist,
    leaves an identical copy untouched, replaces a rebuilt one, drops it when
    the dist is gone, and checks the `files` list and `.gitignore`.
    `scripts/test-packed-cli.mjs` asserts the packed CLI carries
    `web/index.html` exactly when `packages/web/dist/index.html` exists (on
    this branch it does not).
  - Still to do after PR #2 merges into `backend`: extend
    `test-packed-cli.mjs` so the installed `mapedit dev` serves the editor at
    `/` and MCP `screenshot` returns a PNG (marked `TODO(F33)` there).
    Deviation: none.
  - Follow-up (reported by the frontend session): `eslint.config.js` ignores
    `packages/cli/web/**`, because after a local web build the copied, minified
    bundles made `pnpm lint` fail. The template copy stays linted, since it is
    the only lint coverage of the templates' `model.ts` files. Test:
    `cli/test/package-assets.test.ts` asks ESLint which of the two paths it
    ignores.
- **F34 complete:** `docs/protocol.md` adds, as optional fields that this
  backend always sends:
  - `HistoryEntry.action` (`HistoryAction`: `move`, `delete`, `agent_change`)
    and `HistoryEntry.refs`: the moved or deleted object, or the objects an
    Agent change affected. These are the same refs as that change's
    `agent_changed` notice.
  - `MapInfo.kind`: `'map'` for project maps, `'module_preview'` for the
    one-Module scene that MCP `build_module` renders through `/render`
    (section 6 now says to use it instead of the `__module_` id prefix).

  `editResult.failure` codes for nothing to undo or redo, rejection, unknown
  objects and file errors came with F28. `packages/protocol` exports
  `HISTORY_ACTIONS`/`HistoryAction`. `ProjectHistory.record` takes the new
  fields, and both `DiskState` and the mock state fill them. Tests:
  `server/test/structured-fields.test.ts` records a move, a delete and an
  Agent file change on a real project and in mock mode, and captures the
  `build_module` preview scene through a stub screenshot service to check
  `kind: 'module_preview'` (project and mock maps are `'map'`).
  `protocol/test/catalogs.test.ts` compares `HISTORY_ACTIONS` with the
  documented union, and the golden compiler snapshot gained `kind: 'map'`.
  Deviation: none.
- **F35 complete:** `docs/protocol.md` section 4 adds an optional `mapId` to
  `notice`: the map that holds its `refs`. It is set for `agent_changed`,
  `overwritten_by_agent`, `agent_change_overridden` and `edit_rejected`. Flow 2
  states the order: after an Agent change, the backend sends the new scenes
  and `history` first, then `agent_changed`, `overwritten_by_agent` and
  `file_error`. An Agent change that touches several maps sends one notice per
  map, each with its own `mapId`. A change that touches no object sends one
  `agent_changed` with empty `refs` and no `mapId`.
  - `DiskState.refresh` broadcasts before it notifies, and groups refs by map
    (`noticePerMap`).
  - `rebuild` no longer sends `file_error` notices itself; `refresh`, `apply`
    and `travel` send them through `noticeFileErrors` once the build is
    installed.
  - The mock state follows the same order and sets `mapId`.

  Tests: `server/test/notice-order.test.ts` opens two maps on a real server,
  changes each map's structure file, and checks that every editor gets the
  new scene and history before `agent_changed`, with the right `mapId` (the
  notice came first and had no `mapId` before). It also covers
  `overwritten_by_agent` after the scene, `edit_rejected` with its `mapId`,
  and mock mode. Deviation: none.
- **F36 complete:**
  - **Order:** `unsupported` advice now tries the fixes in this order:
    1. lowering the whole Structure;
    2. a clear compatible Socket inside the Structure;
    3. lowering only the Module and its attachment chain;
    4. an obstructed Socket inside the Structure;
    5. a clear Socket in another Structure, which moves and merges a whole
       Structure;
    6. an obstructed one there;
    7. `canFloat`.
  - **Socket options:** they are sorted with same-Structure options first. The
    expensive placement test is lazy: only up to 8 options, nearest first, are
    tested per suggestion, so not every candidate Socket moves a whole
    Structure.
  - **Shared Sockets:** the advice remembers which Module each target Socket
    was suggested for during one check. It prefers a Socket that no other
    Module was given. When only a taken one fits, it adds "wall_n.top is also
    suggested for module:house/roof_a, and a Socket takes one attachment;
    attach only one of them there."
  - **Map bounds:** the placement test checks the moved Module bounds with
    `exceededMapEdges`, the compiler's own test and tolerance (1e-7), instead
    of the solid's bounds with 1e-4. The compiler's Module and marker bounds
    checks call `exceededMapEdges` once instead of repeating its comparisons.
  - Tests: `core/test/suggestions.test.ts` "F36":
    - A lamp floating 0.5 m over a table edge, with a neighbour's free Socket
      3 m away. It is now told to lower the lamp; before, it was told to
      attach the whole house to the neighbour.
    - Two roof halves above one free `wall_n.top`. The second now carries the
      note; before, there was no note.
    - A 1 m model in a 2 m Module next to the east edge. The suggested move
      now stays inside the map when recompiled; before, it produced
      `out_of_bounds`.
    - A performance test with 2,000 Modules, whose 1,000 floating blocks each
      see about ten cross-Structure Sockets. It took 0.33 s on this machine
      both before and after the lazy test, because placements are cached and
      boxes use arithmetic; it stays as the measurement F20 lacked.
  - Deviation: none.
- **F37 complete:**
  - **Revision race:** `registerTool`'s `run` validates the arguments, flushes
    file changes, reads the project revision right away, and only then runs
    the tool. The handlers no longer flush themselves, so there is still one
    flush per call. A change processed while the tool runs now voids the
    continuation cursor; before, it was labelled with the newer revision.
    Test: `server/test/mcp-paging.test.ts` "F37" processes a change during a
    paged `query`. The continuation answers "Results changed…"; before, it
    served the page.
  - **Argument errors:** invalid arguments are explained one sentence each,
    instead of zod's JSON report:
    - "Missing required argument z (number)."
    - "Argument x must be a number."
    - "Unknown arguments "size", "depth"; remove them."
    - "Argument command.operation must be one of …"

    Tests: the same file, plus the updated F17 and paging tests in
    `mcp-schema.test.ts` and `mcp-paging.test.ts`.
  - **Enumerations:** `packages/protocol/src/violation-params.ts` declares
    each one once as an `as const` list and derives its type from it:
    `OFF_GRID_FIELDS`, `ROTATION_FIELDS`, `ROTATION_STEPS`, `MAP_EDGES`,
    `MISSING_REFERENCE_REASONS`, `SOCKET_PROBLEMS` and `OVERLAP_TARGETS`. The
    params check uses the same lists. Test: `protocol/test/catalogs.test.ts`
    compares three of them with the lists in protocol.md section 3 and has
    the check accept every value.
  - **Socket addresses:** `socketAddress(instance, socket, structure?)` in
    `socket-rules.ts` writes the `attach` format. The compiler's
    `socketAddresses` and the geometry suggestions both use it. Test:
    `core/test/suggestions.test.ts` "F37", plus the F27, F36 and performance
    tests that read the addresses in suggestions.
  - **Naming:** `ToolResultPager.firstPage` is now `paginate`, since every
    result passes through it. Test: the F24 terminology test.
  - **Types:** `StateStore.entries` and `cursor` are `readonly`. Test:
    `server/test/history.test.ts` reads the modifiers from the source.
  - **Packed acceptance:** `scripts/test-packed-cli.mjs` checks before packing
    that no package's `src` is newer than its `tsconfig.tsbuildinfo`, using
    the new `scripts/build-freshness.mjs`. If one is, it stops with "Run pnpm
    build first: …". It loads the server's containment check from `dist` only
    after that check. Test: `cli/test/package-assets.test.ts` "F37" with fake
    packages that are fresh, stale and never built.
  - Deviation: none.
- **Kept on purpose – `--enable-unsafe-swiftshader` (listed under 這次不用改):**
  the flag lets Chrome or Edge fall back to SwiftShader, a software WebGL. Chrome
  calls it unsafe because a hostile page could reach that rasterizer. Here the
  headless browser only opens the backend's own `/render` page:
  `ScreenshotService` aborts every request that is not to the backend's origin,
  `data:` or `blob:`, so the page runs only the editor build and loads only
  the backend's own GLBs. Without the flag, machines without a GPU, such as
  GitHub's Ubuntu runners, cannot create a WebGL context and every screenshot
  fails. It stays in `SCREENSHOT_BROWSER_ARGS`; the test that checks the flag
  is unchanged.
- **Extra (frontend FE18):** `docs/protocol.md` section 4 now describes
  `Edit.position` as where the object's origin should go (a Structure's
  `position`, a point marker's `position` or a box marker's `center`), not
  the point under the pointer. The wording is copied exactly from the frontend
  branch (`2b094d9`), so both branches merge cleanly. No code reads it
  differently, and the MCP texts never described it.
- **Still for a person:** the F17 real Claude Code check stays under 需要人處理,
  unchanged.

## 第四輪修正

F38–F43 from `docs/handoff/backend-fixes-4.md`, fixed on the same `backend` branch.

- **F38 complete:**
  - **What counts toward the limit:** `EXACT_OVERLAP_LIMIT` (200) now counts
    only overlaps that needed a Boolean, that is pairs where at least one
    Module is not a box. Box overlaps stay exact and no longer push round
    Modules into estimates.
  - **Edits are exact:** `checkGeometry` takes `GeometryCheckOptions.exact`.
    `DiskState.preview`, which `apply` also uses, marks the moved Structure's
    Modules with it, so their pairs are always exact and an estimate never
    blocks a human edit.
  - **Support:** estimated pairs no longer give Support. Their contacts are
    deferred: after the exact Support is known, each deferred pair whose lower
    Module is supported and whose upper Module is not is probed exactly with
    `restsOn`, repeated until nothing new is found. Modules already supported,
    such as everything on terrain, need no probe. `estimatedRest` is gone.
  - **Wording:** the message is now "may overlap …; estimated from bounding
    boxes after 200 overlaps that needed exact shapes". protocol.md section 3
    explains which overlaps count, that estimates may over-report (about half
    are false for round Modules), that a check is fully exact again only below
    200 such overlaps, that estimated contact is not Support, and that edits
    are exact.
  - Tests:
    - `core/test/geometry.test.ts` "F38": two diagonal round towers beside 207
      box overlaps are not reported. Before, they were a "probably overlaps"
      estimate.
    - The same file: with 250 round overlaps, a disc floating diagonally above
      another is unsupported (before, an estimated contact supported it), a
      disc stacked exactly on another stays supported, and estimates say "may
      overlap".
    - `server/test/estimated-overlaps.test.ts`: on a real project with 250 round
      overlaps, a round Structure moves diagonally next to another through
      `preview` and `apply`. Before, the estimate rejected it.

  Deviation: none.
- **F39 complete:** protocol.md section 4 adds two optional fields to
  `HistoryEntry`. `mapId` is the map of a human move or delete. `maps` lists
  an Agent change's affected objects by map, as `[{ mapId, refs }]`, and is
  empty when no object changed. `refs` stays, with all maps merged. The
  protocol package exports `MapRefs`. `ProjectHistory.record` takes a
  `RecordedChange` (an entry without id and time). `DiskState` groups the
  refs keyed `<mapId>\0<ref>` with the same helper as the per-map notices
  (`refsByMap`), and the mock state fills both fields. Tests:
  `server/test/structured-fields.test.ts` "F39": two maps both have
  `structure:house`, and one Agent change moves both. The entry's `maps`
  separates them, and a human move on `town` carries `mapId: 'town'`; mock
  mode too. Both failed before. Deviation: none.
- **F40 complete:**
  - **Deleted maps:** `DiskState.rebuild` builds the selected map first and
    uses its parsed project to tell which cached maps still exist
    (`projectHasMap`: a listed map, or a `map.yaml` that cannot be read). A
    deleted map leaves the cache instead of being rebuilt as a missing map;
    if it was the selected map, the first remaining map is selected. Editors
    that have it open get `notice { level: 'error', code: 'unknown_map',
    mapId }`; `broadcast` routes such a notice only to them. A later `openMap`
    answers `unknown_map`. protocol.md flow 2 says so, replacing the sentence
    about a scene with a "does not exist" file error.
  - **One failed rebuild:** after a successful apply, undo or redo, an open
    map whose scene fails to rebuild sends its editors a `file_error`. The
    other scenes and `history` are still broadcast.
  - **Paths:** `internal_error` reasons, request `file_error` notices and the
    watcher's error notices pass through `projectRelativePaths`, which writes
    paths inside the project relative to it with `/`. It stops at a separator,
    quote, space or the end, so `C:\proj2` is not taken for `C:\proj`. It
    looks for every spelling of the root (`rootSpellings`): as given, through
    `realpathSync` and through `realpathSync.native`, longest first, without
    regard to case on Windows. GitHub's Windows runners spell their temp
    folder with a short 8.3 name (`RUNNER~1`) that only the given spelling
    has; PR #1's first Windows CI run failed on it before this was added.
  - **Editor build:** `ServerOptions.webRoot` also accepts a list of
    candidates. The server looks them up on every request and screenshot
    (`ScreenshotService` asks through `editorBuilt`). The CLI passes
    `[SERVER_WEB_ROOT, <cli>/web]`, so an editor built after `mapedit dev`
    started is served and rendered without a restart.
  - Tests: `server/test/edge-cases.test.ts` "F40" checks each point; all of
    them failed before:
    - a deleted open map leaves the cache and notifies only its editor;
      `openMap` then answers `unknown_map`, and later changes do not rebuild
      it;
    - `history` and the village scene still arrive when the town scene throws;
    - an EBUSY error with an absolute path is answered with
      `maps/village/structures/a.yaml`;
    - the same holds, for request errors and watcher errors, when the server
      gets the root through a link or, on Windows, by its short 8.3 name;
    - a build made after start is served and no longer reported missing;
    - `projectRelativePaths` cases, including a sibling directory and two
      spellings of the root where one holds the other.

  Deviation: none.
- **F41 complete:** one whole screenshot shares a single time limit,
  `SCREENSHOT_TIMEOUT_MS` = 50 s, below the 60 s after which MCP clients give
  up by default. Waiting for the browser to start, `page.goto`, waiting for
  `mapeditRenderReady` and `mapeditRender` each get only the time that is
  left. Each stage has its own message:
  - "The headless browser did not start within 50 seconds. Try again."
  - "The render page did not become ready within 50 seconds and was closed…"
  - "The render page did not finish within 50 seconds and was closed…"

  `capture` reduces every failure to its first line and cuts it at 1,000
  characters. The constructor option is now `timeoutMs` (the whole capture);
  `ServerOptions.screenshotTimeoutMs` still sets it.
  - Tests in `server/test/screenshot.test.ts`, "F41":
    - the default stays below the MCP SDK's `DEFAULT_REQUEST_TIMEOUT_MSEC`;
    - a fixture page that never becomes ready fails within the shortened
      limit (before, it waited 30 s);
    - a browser launch error with a 1,500-character path comes back as one
      capped line.
  - The F31 tests now start the browser before timing a hanging render, since
    the limit includes the launch.

  Deviation: none.
- **F42 complete:** `DiskState.writeAll` writes one change (an apply, an undo or
  redo, or an Agent tool's file update) in two phases:
  1. Each new content goes to a temporary file
     `<target>.mapedit-<uuid>.tmp` beside its target, after the existing
     containment checks (`writableTarget`). The `.tmp` name is never read as
     a project input.
  2. Only when every temporary file is written are the targets replaced by
     rename, or removed, one by one.

  A failure while staging removes the temporary files and leaves the project
  untouched. A failure while replacing writes the previous contents back to
  the files already replaced, then removes the rest. Either way, the baseline,
  the history and its cursor stay as they were, so the next refresh records
  nothing and redo is kept. `DiskState.create` takes the file operations as an
  optional argument (`ProjectFileOperations`) so tests can make a step fail.
  protocol.md flow 10 now states that such a failure leaves files and history
  unchanged, so retrying is valid.
  - Tests in `server/test/atomic-writes.test.ts`; both failed before:
    - undoing an Agent change of two files, while the second replacement
      fails with EBUSY, leaves both files, the cursor and the history
      unchanged and no `.tmp` file;
    - an apply whose staging fails changes nothing, and the same edit then
      succeeds.

  Deviation: none.
- **F44 complete (added by the user's decision):** `.github/workflows/ci.yml`
  triggers on `push` to `main` only, with `pull_request` unchanged, so a push
  to `backend` no longer runs the same matrix twice on PR #1. The
  Windows/Ubuntu × Node 22/24 matrix stays as the user asked. The item is
  appended to `backend-fixes-4.md`. Test: `cli/test/package-assets.test.ts`
  "F44" parses the workflow. Its push branches are only `main`; before, they
  were `main` and `backend`. `pull_request` and the 2 × 2 matrix are kept.
  Deviation: none.
- **F43 cancelled (the user decided to wrap up this round):**
  - **The problem:** touching Modules of a turned Structure still need one
    Boolean per pair, because the oriented-box pre-check skips only boxes that
    are at least 1e-7 m apart.
  - **Measured before stopping, on this machine:** 2,000 touching one-metre
    Modules in one Structure turned 30° took
    - 0.95 s for boxes;
    - 1.6 s for boxes with a door;
    - 1.9 s for 32-sided cylinders;
    - 4.0 s for 64-sided cylinders.
  - **The planned fix, not started:** count a pair as touching, without a
    Boolean, when the oriented boxes overlap by at most 1e-6 m along some
    axis, for both the overlap test and the rest probe.
  - **The unfinished test:** it is kept only in the local stash
    (`F43 (canceled): touching turned Modules performance test, not
    implemented`), not committed and not pushed.
