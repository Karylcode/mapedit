**English** | [繁體中文](troubleshooting.zh-TW.md) · [Documentation index](README.md)

# Troubleshooting

## Starting and updating

- **`Node.js was not found` from a `.bat` file**: install Node.js 22.13 or later from https://nodejs.org,
  then run the file again. The launcher also stops with `需要 22.13 以上` when Node.js is older.
- **The launcher fails at `pnpm install` and `corepack` is not recognized**: the launcher runs pnpm through
  Corepack, and Node.js 25 and later no longer include it. Run `npm install -g corepack`, or use Node.js 22
  or 24.
- **The launcher says the build finished but `packages/web/dist` is missing**: the checked-out version has
  no browser editor. Update with `更新.bat`.
- **A dropped folder is `不是地圖專案資料夾`**: only a folder with a `project.yaml`, or a file inside one, can
  be dropped onto `啟動地圖編輯器.bat`.
- **The browser shows a different project than expected**: port 4790 was already in use, so the launcher
  only opened the browser on the editor that was already running. Close the other editor window and start
  again.
- **`更新.bat` says `找不到 Git`**: install Git from https://git-scm.com/download/win.
- **`更新.bat` lists files changed on this computer and stops**: it never overwrites your changes to
  tracked files. Undo the changes (for example `git restore <file>`) if you do not need them, then update.
- **`更新.bat` says the local branch has commits GitHub does not**: it only fast-forwards. Decide which side
  to keep (for example with `git log` and `git rebase`), then update.
- **`更新.bat` cannot reach GitHub**: check the network and try again later.

## The editor

- **The page says `Mapedit backend is running. Build packages/web to use the editor.`**: run `pnpm build`.
- **`listen EADDRINUSE` for port 4790**: another program, or another editor, uses the port. Close it, or
  start with `mapedit dev --port <port>`. The HTTP MCP settings point at 4790, so the agent then needs the
  stdio settings ([Agent workflow](agent-workflow.md#connecting)).
- **`Host or Origin is not allowed.`**: the server answers only `http://127.0.0.1:<port>` and
  `http://localhost:<port>`. It refuses other host names, such as the computer's network address, and
  requests from other websites.
- **A drop is refused and the object jumps back**: putting it there would cause a violation. While you
  drag, the note next to the pointer names the first violation; move the object elsewhere.
- **A module or an attached structure does not move**: only whole structures and markers move. Drag the
  root structure. A single module can still be deleted.
- **No edit is accepted**: a project file cannot be read. Fix the file error shown on the left first.
- **`Not connected to the editor server; the change was not sent`**: the server stopped or is restarting.
  Start `mapedit dev` again; the page reconnects.

## Agents and MCP

- **The agent edits a different project**: HTTP MCP works on the project open in the editor. Switch the
  **Project** menu, or use the stdio settings.
- **The agent has no Mapedit tools**: with the HTTP settings, the editor must be running. Start it, or use
  `.mcp.stdio.json` / `.codex/config.stdio.toml`, which start a server when needed.
- **stdio stopped working after moving folders**: the stdio settings hold absolute paths to Node.js and the
  CLI. Update them, or run `init` in a new folder and copy the paths.
- **`Results changed since the first page.`**: project files changed while the agent read a paged result.
  Run the tool again without `cursor`.
- **`This continuation cursor is unavailable or expired.`**: paged results last five minutes. Check the
  current state before repeating a tool that changes things.
- **A `model.ts` file error**: the model failed, ran past its time limit, or does not fit the declared size.
  Use `build_module` for the diagnostics; limits are in [Module modelling API](model-api.md).

## Screenshots

| Message starts with                                   | What to do                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| `No supported system browser was found`               | Install Edge or Chrome.                                          |
| `The editor web build is missing; run pnpm build.`    | Run `pnpm build`, then try again.                                |
| `The headless browser did not start within 50 seconds` | Try again; the browser keeps starting in the background.        |
| `The render page did not become ready within 50 seconds` | Check that the editor page loads in your browser, then try again. |
| `The render page did not finish within 50 seconds`    | Ask for fewer `views` or a smaller `tileSize`.                   |
| `Render page error:`                                  | The page reported a problem, such as no WebGL or an unknown map. |

## Check and export

- **`check` exits with code 1**: some map has a violation or a file error. Read the list, fix, check again.
  `canFloat` entries are information only and do not change the exit code.
- **`Export refused for maps: …`**: the named maps have violations or file errors, and nothing was written.
  Run `check` and fix them first.
- **`export requires --out <directory>.`** / **`--map requires a map ID.`**: add the missing value.
- **`Init refused to overwrite existing file: …`**: `init` never overwrites files. Use an empty or new folder.
- **`… has no projects.`** after `dev --projects <folder>`: create one with `mapedit init <folder>/my-maps`.
- **Terrain file errors**: provide both `terrain/height.png` and `terrain/surface.png` with the map's size,
  or neither for flat grass. Edit terrain with the `terrain` tool, not by hand.

## Unity

- **A marker has no prefab**: no mapping entry matches its type. This is on purpose: the marker and its data
  stay for your game code. Add an entry to the Marker Mapping asset.
- **Several mapping assets**: pick one in **Project Settings → UnityGLTF → Mapedit game metadata**.
- **`Unity 6 is not installed at …`** from `scripts/test-unity.ps1`: pass `-UnityPath <path to Unity.exe>`.
- **`Unity timed out` or `Verification produced no result`**: read the log file named in the message, under
  `.cache/unity/project`.
