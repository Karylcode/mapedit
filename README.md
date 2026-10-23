**English** | [繁體中文](README.zh-TW.md)

# Mapedit

[![CI](https://github.com/Karylcode/mapedit/actions/workflows/ci.yml/badge.svg)](https://github.com/Karylcode/mapedit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22.13+](https://img.shields.io/badge/node-22.13%2B-blue.svg)](https://nodejs.org/)
[![Unity 6](https://img.shields.io/badge/Unity-6-orange.svg)](integrations/unity/README.md)

Mapedit is an agent-first 3D game map editor. AI coding agents such as Claude Code and Codex build maps by
editing text files and calling MCP tools. The editor works like a compiler: it works out the exact position
of every piece, flags overlaps, floating pieces and other violations, and shows the map live in the browser,
where people make quick fixes with Minecraft-like controls. Maps export as glTF, and an import package turns
them into playable Unity 6 levels. Built with TypeScript, three.js and manifold-3d; it runs only on your computer.

## What it does

- **Maps are text files.** Projects, modules, maps, structures and markers are YAML, and terrain is two
  PNG images. Git keeps the history, and comments survive edits made in the browser.
- **Agents build, the editor checks.** `init` writes an `AGENTS.md`, a Claude Code skill and MCP settings
  for Claude Code and Codex. The MCP server has 10 fixed tools, from `check` and `screenshot` to `terrain`.
- **Strict rules.** Pieces snap to a 0.5 m grid and to compatible sockets. `check` reports overlaps,
  missing support, off-grid positions and angles, out-of-bounds objects, missing references and incompatible
  sockets, each with a suggested fix. A map with violations does not export.
- **A browser editor for quick fixes.** Orbit, pan and zoom; select, drag, turn in 15° steps, delete, undo
  and redo. A drop that would cause a violation is refused. Press V to fly through the map in first person.
  The interface is in Traditional Chinese or English.
- **Modules written as code.** Each module's shape is a `model.ts` that uses a small modelling API on
  manifold-3d. It runs isolated in QuickJS. Built-in materials are textured at real-world size.
- **Terrain.** 1 m tiles, each with a height and a surface. The `terrain` tool raises, lowers, flattens,
  paints and piles up mountains. Foundations reach down to sloped ground by themselves.
- **glTF export.** One self-contained `.glb` per map with the hierarchy, materials, mesh colliders and
  marker data. The Unity 6 package turns that data into colliders, trigger boxes and your own prefabs.
- **Local only.** The server listens on `127.0.0.1` and calls no AI or other online service while it runs.

## Requirements

- Node.js 22.13 or later
- pnpm 11.19. The Windows launcher runs it through Corepack, so that route needs no separate install.
- Windows or Linux. CI tests both, with Node.js 22 and 24.
- Edge or Chrome, for the MCP `screenshot` tool
- Git, for `git clone` and `更新.bat`
- Optional: Unity 6 with UnityGLTF 2.21.0, to import maps into Unity

Details: [Installation](docs/installation.md).

## Quick start

**Windows:** download the repository (Git clone or ZIP) and double-click `啟動地圖編輯器.bat`. The first
run installs and builds the editor, which takes a few minutes, adds the example church project, and opens
`http://127.0.0.1:4790` in your browser.

**Any system:**

```sh
git clone https://github.com/Karylcode/mapedit.git
cd mapedit
pnpm install
pnpm build
pnpm mapedit init projects/my-maps
pnpm mapedit dev --open --projects projects --project my-maps
```

Then start Claude Code or Codex in `projects/my-maps` and ask, for example: "Build a small village with
three houses, a road and a spawn point." The agent edits the files, runs `check` and `screenshot`, and
fixes what they report while you watch in the browser.

Next: [Usage](docs/usage.md).

## Troubleshooting

- **A `.bat` file says `Node.js was not found`**: install Node.js 22.13 or later from https://nodejs.org.
- **The agent edits a different project**: HTTP MCP works on the project open in the editor. Pick the
  right one in the **Project** menu at the top left, or use the stdio settings that `init` wrote.
- **`screenshot` fails**: install Edge or Chrome, and run `pnpm build` so the editor page exists.
- **`更新.bat` stops without updating**: it never overwrites files you changed in the repository, and it
  lists them. Keep your maps in `projects/`, which updates leave alone.

More: [Troubleshooting](docs/troubleshooting.md).

## Documentation

- [Documentation index](docs/README.md): every page, plus the design and handoff notes
- [Installation](docs/installation.md): requirements, the Windows launcher, manual setup, updating
- [Usage](docs/usage.md): starting the editor, the projects folder, editor controls, CLI commands
- [Map files](docs/map-files.md): project layout, modules, structures, markers, terrain, violations
- [Agent workflow](docs/agent-workflow.md): agent setup, the 10 MCP tools, the edit-check-screenshot loop
- [Exporting](docs/exporting.md): GLB export, the Unity 6 package, other engines
- [Troubleshooting](docs/troubleshooting.md): common problems and error messages
- [Development](docs/development.md): repository layout, tests, CI, frontend work, packaging the CLI
- [Backend status](docs/handoff/backend-status.md): backend milestones M0–M7 are implemented; acceptance records
- [Frontend status](docs/handoff/frontend-status.md): browser editor milestones W0–W6 are implemented; acceptance records

## License

MIT. See [LICENSE](LICENSE).

- The built-in material images are CC0 textures from Poly Haven. Sources and checksums are in
  [SOURCES.md](packages/core/materials/SOURCES.md).
