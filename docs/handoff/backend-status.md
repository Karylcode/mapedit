# Backend implementation status

## 目前進度

M0–M2 complete on `backend`. M3 terrain integration is in progress.
Next: connect terrain PNGs, chunk assets and foundations to the real project build.

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
- M3–M7: pending final integration/acceptance.

## 自行決定的事

- Work is split across independent package owners; milestone commits remain ordered.
- Node 24 is the CI runtime; the declared minimum is Node 22.13 for permission support.
- Tests run without `packages/web`; the real frontend is owned by Claude.
- Socket direction supports up/down plus the four compass directions. Attachments
  infer orientation; structures connect through `structure/instance.socket` paths.
- Height PNGs use signed offset encoding (`sample = meters * 2 + 32768`); absent
  terrain PNGs represent flat ground. Both files are required once either exists.
- Untrusted model code executes in QuickJS WASM inside a permission-restricted
  disposable Node child. Node permissions alone are not treated as a sandbox.
- `canFloat` modules can support attached/stacked modules, allowing floating
  platforms. Foundations support skirt or pillar geometry; both clip to terrain.

## 偏離設計

None identified yet.

## 需要人處理

None identified yet. GitHub authentication is available.

## 需要前端配合

Implement the existing protocol v1 and `/render` contract after backend review.

## 已知問題

Implementation and acceptance work are in progress; no completion claim yet.
