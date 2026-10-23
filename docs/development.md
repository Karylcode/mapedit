**English** | [繁體中文](development.zh-TW.md) · [Documentation index](README.md)

# Development

## Repository layout

This is a pnpm workspace of TypeScript packages (strict ESM).

| Path                 | Contents                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| `packages/core`      | Domain model, map file reading and writing, compiler, rule checks, terrain, modelling API, glTF output, built-in materials |
| `packages/protocol`  | Message types shared by the server and the browser editor ([protocol.md](protocol.md)) |
| `packages/server`    | Local server: file watching, WebSocket, MCP, screenshots, change history              |
| `packages/cli`       | The `mapedit` command                                                                 |
| `packages/web`       | Browser editor and the `/render` screenshot page (three.js)                           |
| `integrations/unity` | Unity 6 import package                                                                |
| `templates/project`  | What `mapedit init` copies: basic modules, the example village, agent instructions, MCP settings |
| `templates/church`   | The Grey Church example the Windows launcher copies to `projects/church`              |
| `templates/authoring.md` | Source of the agent instructions                                                  |
| `scripts`            | Launcher, updater, end-to-end test, packaging and Unity checks                        |

## Scripts

Run these from the repository root after `pnpm install`.

| Command                   | What it does                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `pnpm build`              | Prepare the CLI templates, compile with `tsc -b`, build `packages/web/dist`    |
| `pnpm typecheck`          | Type-check every package                                                       |
| `pnpm test`               | Run all Vitest tests                                                           |
| `pnpm lint`               | ESLint over `packages`                                                         |
| `pnpm format` / `pnpm format:check` | Prettier, writing or checking                                        |
| `pnpm e2e`                | The end-to-end village check (needs `pnpm build` first)                        |
| `pnpm generate:authoring` | Rewrite the agent instructions from `templates/authoring.md`                   |
| `pnpm mapedit <command>`  | Run the built CLI                                                              |
| `pnpm dev:web`            | Vite dev server for the browser editor                                         |

## Tests

```sh
pnpm typecheck
pnpm test
pnpm e2e
```

- `pnpm test` runs every `packages/**/test/**/*.test.ts`. The browser tests drive the editor and `/render`
  in the system's Edge or Chrome, headless. Without a browser they are skipped, except when the `CI`
  environment variable is set, where a missing browser fails the run.
- `pnpm e2e` uses no AI. It creates a project with `init`, writes three houses, raises a mountain and paints
  a gravel road, keeps the template's spawn and trigger markers, checks for zero violations, and exports a
  GLB. It prints the project and GLB paths. Pass a folder to keep the project there:
  `node scripts/e2e.mjs <folder>`.

## CI

`.github/workflows/ci.yml` (workflow name "Backend") runs on pushes to `main` and on pull requests. It uses
`ubuntu-latest` and `windows-latest` with Node.js 22 and 24, and runs `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm lint` and `pnpm test`. It does not run `pnpm e2e`, `pnpm format:check` or the
Unity check.

## Frontend development

```sh
pnpm build
pnpm mapedit dev --mock
pnpm dev:web
```

Open `http://127.0.0.1:5173`. The Vite dev server forwards `/api`, `/assets` and `/ws` to
`http://127.0.0.1:4790`. When the backend runs on another port, set `MAPEDIT_BACKEND`, for example
`MAPEDIT_BACKEND=http://127.0.0.1:4791`.

`--mock` serves a fixed test scene, and edits change only memory. `POST /api/mock/trigger` with a body such
as `{"notice": "agent_changed"}` triggers each kind of notice. It exists only in mock mode.

## Agent instructions

`templates/authoring.md` is the single source of the agent instructions. `pnpm generate:authoring` writes
it to `templates/project/AGENTS.md` and, with a front matter block, to
`templates/project/.claude/skills/mapedit/SKILL.md`. `pnpm build` does this too, and copies
`templates/project` into `packages/cli/templates` (ignored by Git). `node scripts/generate-authoring.mjs
--check` fails when the generated files are stale.

## Packaging the CLI

Run `pnpm build` before packing or installing a local tarball. It produces the `dist` of all four packages
and the CLI's own templates. The CLI's `prepack` refreshes the templates; packing core, server or protocol
does not recompile TypeScript.

```sh
pnpm build
pnpm --dir packages/cli pack --pack-destination ../../.cache/packages
node scripts/test-packed-cli.mjs --keep
```

The last command runs `pnpm pack` on the four workspace packages itself. In a temporary folder outside the
repository it installs them offline, with local tarball overrides and the repository's locked dependency
graph, then runs `init` and `check` with the packed CLI. An earlier `pnpm install --frozen-lockfile` must
have filled the package store. The test install also uses a frozen lockfile and reuses the repository's
store explicitly, so Windows does not pick an empty store on another drive. The output lists the kept
temporary path. The test checks that the packages and their dependencies do not reach back into the
repository, and that models, materials, WASM and templates all work.

Every package still has `"private": true`. Before publishing to npm, a person has to decide the package
names, the scope for the `@mapedit` packages, and the npm account. Nothing has been published.

## Unity check

`scripts/test-unity.ps1 -GlbPath <village.glb>` imports a GLB in Unity 6 batchmode and checks colliders,
the trigger and the spawn prefab. See [Exporting](exporting.md#verify-the-unity-import).

## Project status

The backend (milestones M0–M7) and the browser editor (W0–W6) are implemented. The acceptance records are
[backend-status.md](handoff/backend-status.md) and [frontend-status.md](handoff/frontend-status.md). Design
notes, decision records and the other handoff files are listed in the
[documentation index](README.md#project-notes).
