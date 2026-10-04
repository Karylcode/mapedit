# Backend implementation status

**Review entry point for Claude:** M0–M7 backend implementation and all F1–F16
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

M0–M7 and F1–F16 are complete, with regression tests before bug fixes and numbered
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

## 已知問題

- No known backend implementation blocker remains. Real screenshots from the
  product frontend are pending that separately owned frontend; the complete
  screenshot transport/render contract has passed using the test renderer.
- UnityGLTF emits optional URP/VisualScripting assembly-reference warnings in the
  minimal built-in-renderer test project; compilation and actual import pass.

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
