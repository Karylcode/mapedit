**English** | [繁體中文](installation.zh-TW.md) · [Documentation index](README.md)

# Installation

## Requirements

- **Node.js 22.13 or later.** `package.json` sets `engines.node` to `>=22.13`, and the Windows launcher
  checks the version before it does anything else.
- **pnpm 11.19.** `package.json` pins `pnpm@11.19.0`. The Windows launcher runs that version through
  Corepack, which ships with Node.js 22 and 24, so it does not need pnpm on `PATH`. The manual setup needs
  `pnpm` on `PATH`, because `pnpm build` calls `pnpm` again ([pnpm installation](https://pnpm.io/installation)).
- **Windows or Linux.** CI runs typecheck, lint and tests on `windows-latest` and `ubuntu-latest` with
  Node.js 22 and 24. The two `.bat` files are for Windows only.
- **Edge or Chrome** for the MCP `screenshot` tool and the browser tests. They run the browser headless.
  Mapedit looks in the usual install folders: Edge or Chrome on Windows and macOS, and `google-chrome`,
  `chromium`, `chromium-browser` or `microsoft-edge` under `/usr/bin` on Linux.
- **Git** for `git clone` and for `更新.bat`.
- **A network connection** the first time, to install dependencies (and UnityGLTF in Unity). After that
  Mapedit calls no online service: the material images and other assets are in the repository.
- **Optional: Unity 6** with UnityGLTF 2.21.0, to import maps. See [Exporting](exporting.md).

The packages are not published to npm yet (every `package.json` keeps `"private": true`). You run the CLI
from this repository.

## Windows: the launcher

1. Get the repository: `git clone https://github.com/Karylcode/mapedit.git`, or download the ZIP from
   GitHub and unpack it.
2. Double-click `啟動地圖編輯器.bat`.

The launcher (`scripts/launch-editor.mjs`) then:

- checks that Node.js is 22.13 or later;
- runs `pnpm install --frozen-lockfile` and `pnpm build` whenever the checked-out commit differs from the
  last build. The first time this takes a few minutes;
- creates the `projects/` folder and copies the Grey Church example (`templates/church`) into
  `projects/church` if it is missing;
- moves an older map project from `../mapedit-maps` (next to the repository) to `projects/my-maps`;
- starts the editor with `mapedit dev --open --projects projects` and opens `http://127.0.0.1:4790`.

Closing the launcher window stops the editor. If port 4790 is already in use, the launcher assumes the
editor is running and only opens the browser.

To open a particular project, drag its folder (or any file in it) onto `啟動地圖編輯器.bat`. A project
inside `projects/` opens with the others available in the **Project** menu; a project elsewhere opens on
its own.

## Manual setup (any system)

```sh
git clone https://github.com/Karylcode/mapedit.git
cd mapedit
pnpm install
pnpm build
```

`pnpm build` compiles the TypeScript packages and builds the browser editor into `packages/web/dist`.
The CLI is then `packages/cli/dist/index.js`:

- from the repository root, `pnpm mapedit <command>` runs it;
- from anywhere else, run `node <repository>/packages/cli/dist/index.js <command>`.

In these docs, `mapedit <command>` means either form. Create a first project and open it:

```sh
pnpm mapedit init projects/my-maps
pnpm mapedit dev --open --projects projects --project my-maps
```

Keep map projects in `projects/`. Git ignores that folder, so your maps never show up as changes to the
repository. See [Usage](usage.md).

## Updating

**Windows:** double-click `更新.bat`. It runs `scripts/update.mjs`, which:

- fast-forwards the checkout to its GitHub branch (`main`) and lists the new commits;
- for a folder unpacked from a ZIP, asks first (type `Y`), then connects it to
  `https://github.com/Karylcode/mapedit.git`, downloads `main` and writes its files over the program files.
  Other files you put in the folder stay;
- stops without changing anything if tracked files were edited on this computer, or if the local branch
  has commits that GitHub does not. It lists what it found;
- moves untracked files that a new commit would overwrite to `.cache/update-backup/<time>/`;
- never touches `projects/`.

The next start of `啟動地圖編輯器.bat` notices the new commit and rebuilds. If the editor is still open, the
updater reminds you to close it first, because it is still running the old version.

**Manually:**

```sh
git pull
pnpm install
pnpm build
```

Then restart `mapedit dev`.
