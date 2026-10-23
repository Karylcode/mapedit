**English** | [繁體中文](agent-workflow.zh-TW.md) · [Documentation index](README.md)

# Agent workflow

The agent, for example Claude Code or Codex, runs on your computer and connects to the editor from outside.
The editor has no AI built in. The agent edits the [map files](map-files.md) directly and uses MCP tools to
check, inspect, change terrain and look at the result.

## What `init` writes for agents

| File                             | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `AGENTS.md`                      | Instructions: workflow, file format, modules, terrain, common errors. Codex reads this file |
| `.claude/skills/mapedit/SKILL.md` | The same instructions as a Claude Code skill                                   |
| `.mcp.json`                      | Claude Code: MCP over HTTP at `http://127.0.0.1:4790/mcp`                       |
| `.mcp.stdio.json`                | Claude Code: MCP over stdio, the fallback                                       |
| `.codex/config.toml`             | Codex: MCP over HTTP at `http://127.0.0.1:4790/mcp`                             |
| `.codex/config.stdio.toml`       | Codex: MCP over stdio, the fallback                                             |
| `.gitignore`                     | Ignores `.mapedit/`, where `mapedit dev` records the running server            |

Everything written for agents (instructions, tool descriptions, violation messages) is in English, which
agents read most reliably and with the fewest tokens.

## Connecting

**HTTP (default).** Start the editor first (`mapedit dev` or the Windows launcher). MCP is served at `/mcp`
on the editor server. It works on the project currently open in the editor, so switch the **Project** menu
to the agent's project.

**stdio (fallback).** Use it when the HTTP tools are unavailable: the editor is not running, it runs on
another port, or another project is open. For Claude Code, replace the contents of `.mcp.json` with
`.mcp.stdio.json`; for Codex, replace the section in `.codex/config.toml` with `.codex/config.stdio.toml`.

- The stdio settings run `mapedit mcp` with the absolute paths of Node.js and the CLI from when `init` ran.
  This avoids `npx` launch problems on Windows. If the project or the repository moves, update the paths.
- `mapedit mcp` attaches to this project's running editor server if there is one (it reads
  `.mapedit/server.json`), so file history and screenshots stay shared. Otherwise it starts its own server
  on a free port and stops it when the agent disconnects.

## The loop

`AGENTS.md` tells the agent to work like this:

1. Read the map and structure YAML. Use `modules` and `free_sockets` to find sizes and attachment options.
2. Edit the files with stable, descriptive ids. Give each large structure its own file, and keep comments
   that explain the design.
3. Run MCP `check` (or `mapedit check --json`) after each coherent change. Fix every violation and file
   error, then check again.
4. Call `screenshot` for each changed map and look at the image. Fix visual mistakes, and repeat the check
   and the screenshot until both are right.
5. Export once the checks pass: `mapedit export --out ./export`, with `--map <id>` for one map.

A prompt can be one sentence, for example: "Build a small village with three houses, a road and a spawn
point." The design goal is that both Claude Code and Codex reach a map with zero violations from such a
sentence.

## The 10 MCP tools

The tool list is fixed. All coordinates are meters, +Y up, +X east, -Z north. `map` is optional: `check`
and `overview` then cover every map, and the other tools use the current map. List results take `offset`
(default 0) and `limit` (1–100, default 50).

| Tool           | Arguments                                                    | Returns                                                         |
| -------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `overview`     | `map`                                                        | Map size, structures, markers, `canFloat` instances, violation counts |
| `check`        | `map`                                                        | Violations with suggested fixes, file errors, `canFloat` instances, `ok` |
| `screenshot`   | `map`, `structure`, `views`, `tileSize`, `focus`, `highlight`, `showViolations` | A PNG montage of a top view and four angled views |
| `floor_plan`   | `map`, `structure`                                           | A text plan of each floor with module positions                 |
| `query`        | `map`, `x`, `z`                                              | Terrain height, surface and objects at that point               |
| `free_sockets` | `map`, `structure`                                           | Empty sockets and the module sockets that fit them              |
| `modules`      | —                                                            | Module sizes, sockets and support properties                    |
| `build_module` | `module`                                                     | Builds `model.ts` in isolation: diagnostics and a preview PNG   |
| `terrain`      | `map`, `command`                                             | Applies one terrain command                                     |
| `export`       | `map`, `out`                                                 | Writes one GLB; refuses a map with violations                   |

- `screenshot`: `views` is any of `top`, `ne`, `nw`, `se`, `sw` (default all five); `tileSize` is 64–1024
  pixels (default 512); `focus` is `{center: [x, y, z], radius}`; `highlight` takes up to 100 object refs;
  `showViolations` defaults to true.
- `terrain`: `command.operation` is `raise` or `lower` (with `amount`), `flatten` (optional `height`),
  `set_height` or `mountain` (with `height`), or `paint` (with `surface`). `command.region` is
  `{kind: "circle", center: [x, z], radius}`, `{kind: "rectangle", min: [x, z], max: [x, z]}` or
  `{kind: "path", points: [[x, z], ...], width}`. Heights use 0.5 m steps.
- `export`: `out` is relative to the project folder.

Example `terrain` call:

```json
{
  "map": "village",
  "command": {
    "operation": "paint",
    "surface": "gravel",
    "region": { "kind": "path", "points": [[10, 20], [40, 20]], "width": 3 }
  }
}
```

## Long results

Each response carries at most 24,000 characters of text. A longer result or error comes back as
`{"paging": {"fragment": "...", "nextCursor": "...", "totalCharacters": 12345}}`. Call the same tool with
only `{"cursor": "..."}` until `nextCursor` is `null`, then join the fragments in order.

- Continuations read the stored result, so terrain changes, exports and module builds run only once.
  Images come on the first page.
- Stored results expire after five minutes and may be dropped when the cache is full.
- If project files change between pages, the continuation returns
  `Results changed since the first page. Run the tool again without cursor.`
- After an expired or voided cursor, look at the current state before repeating a tool that changes things.

## Screenshots

The server renders screenshots by opening the editor's `/render` page in headless Edge or Chrome, so the
agent sees what a person sees. This needs the editor build (`pnpm build`) and one of those browsers. One
screenshot may take at most 50 seconds; fewer views or a smaller `tileSize` help when it runs out.

Images return as MCP image content without `structuredContent`, because Codex drops images that come with
it ([openai/codex#10334](https://github.com/openai/codex/issues/10334)). They are not only saved as files,
because Codex does not always open image files itself
([openai/codex#12439](https://github.com/openai/codex/issues/12439)). When `/render` is unavailable, the
agent should report that the visual check is still pending: a clean `check` alone says nothing about how
the map looks.

## Writing modules

Agents can write new modules: a `module.yaml` and a `model.ts` in a new folder under `modules/`. Use
`build_module` to get diagnostics and a preview. The model code runs in a fresh QuickJS WebAssembly
runtime inside a separate Node.js process, with a 10-second default deadline and other hard limits.
Details: [Module modelling API](model-api.md).
