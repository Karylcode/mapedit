**English** | [繁體中文](usage.zh-TW.md) · [Documentation index](README.md)

# Usage

`mapedit <command>` below means `pnpm mapedit <command>` from the repository root, or
`node <repository>/packages/cli/dist/index.js <command>` from anywhere else. See [Installation](installation.md).

## Start the editor

On Windows, double-click `啟動地圖編輯器.bat` ([Installation](installation.md#windows-the-launcher)). Anywhere:

```sh
mapedit dev [--port <port>] [--mock] [--open] [--projects <folder> [--project <name>]]
```

| Option                | Effect                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `--port <port>`       | Port to listen on. Default `4790`.                                                       |
| `--open`              | Open the editor in your default browser.                                                 |
| `--projects <folder>` | Serve a folder of projects and allow switching between them in the editor.              |
| `--project <name>`    | With `--projects`: the project to open first. Default: the one opened last, else the first by folder name. |
| `--mock`              | Serve a fixed test scene kept in memory. For frontend work; see [Development](development.md). |

Without `--projects`, `dev` serves the project in the current directory. The server prints
`mapedit listening at http://127.0.0.1:4790` and accepts connections from this computer only. At that
address it serves the browser editor, the `/render` page that MCP `screenshot` uses, and MCP at `/mcp`.
Add `?map=<id>` to the address to open a particular map.

While the editor is open, changes the agent makes to files appear right away. Changes you make in the
browser are written back to the YAML files, keeping their comments.

## The projects folder

Every map project lives in its own folder under `projects/`. A project has its own `project.yaml`,
modules (`modules/`) and maps (`maps/`; a project can have many). Projects do not share modules or maps.
Materials are, for now, one built-in set shared by every project.

- Switch projects in the **Project** menu at the top left. HTTP MCP works on the project that is open, so
  the agent works on whatever you see.
- Create a project with `mapedit init projects/<name>`, or ask the agent to create a folder in `projects/`.
  The editor reads the list again when the pointer moves onto the **Project** menu.
- Git does not track `projects/`, and `更新.bat` leaves it alone.
- The Windows launcher copies `templates/church` (a grey-white gothic church drawn with toon shading,
  `style: toon`) to `projects/church` whenever that folder is missing. Delete it and start again to get
  the latest version. An older project in `../mapedit-maps` is moved to `projects/my-maps`.

The project and map menus, the revision, the connection state and the language switch (Traditional
Chinese or English) sit in the title block at the top left.

## Editor controls

The overview camera looks down on the map.

| Action          | How                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------- |
| Orbit           | Right-drag                                                                                |
| Pan             | Middle-drag, left-drag on open ground, or WASD / arrow keys                               |
| Zoom            | Mouse wheel, toward the pointer                                                           |
| Focus           | F: fly to the selection, or to the whole map when nothing is selected                     |
| Select          | Click selects the whole structure; click a module of the selected structure to select only that module |
| Move            | Drag a structure or a marker. A red preview means it cannot go there; releasing does not apply it |
| Rotate          | R turns 15° (Shift+R the other way), also while dragging                                  |
| Delete          | Delete or Backspace                                                                       |
| Undo, redo      | Ctrl+Z; Ctrl+Y or Ctrl+Shift+Z (Cmd on macOS)                                             |
| Step back       | Esc cancels a drag, then the picked violation, then the selection                        |
| Switch project  | **Project** menu at the top left                                                          |
| First person    | V (see below)                                                                             |

First-person mode lets you fly around inside the map. It is for looking only: you cannot edit there, but
undo and redo still work. You fly through buildings, not through the ground.

| Action            | How                                           |
| ----------------- | --------------------------------------------- |
| Look around       | Move the mouse (or drag, if the browser does not lock the pointer) |
| Fly               | WASD or arrow keys                            |
| Up, down          | Space, Shift                                  |
| Flying speed      | Mouse wheel                                   |
| Back to overview  | Esc or V                                      |

The **Violations** panel on the left lists violations and file errors. Its numbers match the flags on the
map; click an entry to fly to it, and click again to let go. The **Change log** on the right lists every
change, by you or the agent, and has undo and redo buttons.

### How edits behave

- Dragging snaps x and z to the 0.5 m grid. Structures with automatic height follow the terrain; markers
  keep their height above the ground.
- The server checks every drop. A drop that would cause a violation is refused, and the object returns.
- You move structures and markers as a whole. A single module, or a structure attached to another one,
  cannot be moved on its own; move its root structure. A single module can be deleted on its own.
- While a project file cannot be read, the editor shows the file error and accepts no edits until it is
  fixed.
- Undo and redo cover the whole project, including the agent's changes. If you and the agent change the
  same thing, the later change wins and the editor shows a notice.

## CLI commands

Run `check`, `export` and `mcp` inside a project folder.

| Command                                     | What it does                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `mapedit init [directory]`                  | Create a project: seven basic modules, an example village map, `AGENTS.md`, a Claude Code skill and MCP settings |
| `mapedit dev [options]`                     | Start the editor server (see above)                                            |
| `mapedit check [--map <id>] [--json]`       | Check maps for violations and file errors                                      |
| `mapedit export [--map <id>] --out <dir>`   | Write one `<map-id>.glb` per map. See [Exporting](exporting.md)                |
| `mapedit mcp`                               | MCP over stdio. See [Agent workflow](agent-workflow.md)                        |
| `mapedit --help`                            | Print the commands                                                             |

`init` never overwrites existing files. It only adds missing lines to an existing `.gitignore`.

`check` and `export` handle every map unless you pass `--map`. When any map has a violation or a file
error, `check` exits with a non-zero code, so it fits in a git hook or CI job. `export` refuses before
writing any file and names the maps with problems. `check --json` always returns the same shape, with one
entry when `--map` is given:

```json
{ "maps": [{ "map": "village", "violations": [], "fileErrors": [], "floating": [] }] }
```

`floating` lists every `canFloat` module with its ref, module type and world position, including those
that rest on the ground. It is for information only and does not count as a violation. MCP `check` and
`overview` also cover every map by default.

Example, from inside a project:

```sh
node ../../packages/cli/dist/index.js check --map village --json
node ../../packages/cli/dist/index.js export --map village --out ./export
```

(`../../` fits a project in `projects/`; adjust it for other places.)
