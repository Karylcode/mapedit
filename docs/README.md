**English** | [繁體中文](README.zh-TW.md) · [Project README](../README.md)

# Documentation

| Page                                | What it covers                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------- |
| [Installation](installation.md)     | Requirements, the Windows launcher, manual setup, updating                         |
| [Usage](usage.md)                   | Starting the editor, the projects folder, editor controls, CLI commands            |
| [Map files](map-files.md)           | Project layout, modules, maps, structures, markers, terrain, violations            |
| [Agent workflow](agent-workflow.md) | What `init` writes for agents, MCP over HTTP or stdio, the 10 tools, paging        |
| [Exporting](exporting.md)           | `mapedit export`, what the GLB holds, the Unity 6 package, other engines           |
| [Troubleshooting](troubleshooting.md) | Common problems and error messages                                               |
| [Development](development.md)       | Repository layout, scripts, tests, CI, frontend work, packaging the CLI            |

## Project notes

Records written while Mapedit was designed and built. They stay as they are. Most are in Traditional
Chinese; the three format references are in English.

**Status:** the backend (milestones M0–M7) and the browser editor (W0–W6) are implemented. The acceptance
records are [backend-status.md](handoff/backend-status.md) and [frontend-status.md](handoff/frontend-status.md).

### Design and specifications

| Note                                   | What it covers                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| [Glossary](../GLOSSARY.md)              | The project's terms and the words to avoid (Chinese)                            |
| [Design](design.md)                    | First-version design: goals, spatial rules, agent and human interfaces, scope (Chinese) |
| [Frontend–backend protocol](protocol.md) | Messages between the browser editor and the server (Chinese)                  |
| [Map format](map-format.md)            | Full reference for map files, version 1 (English)                               |
| [Module modelling API](model-api.md)   | `model.ts` functions, materials, the sandbox and its limits (English)            |
| [Export format](export-format.md)      | GLB hierarchy and `extras.mapedit` fields, version 1 (English)                  |

### Decision records

| Record                                                         | Decision                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| [0001](adr/0001-two-level-grid.md)                             | Two-level grid: one for the map, one per structure        |
| [0002](adr/0002-local-first-open-source.md)                    | Runs locally, open source on GitHub                       |
| [0003](adr/0003-agent-first-simple-ui.md)                      | Agent first; human controls as simple as Minecraft        |
| [0004](adr/0004-map-as-text-files.md)                          | The readable text files are the source of truth           |
| [0005](adr/0005-mcp-and-cli.md)                                | Commands are offered through both MCP and the CLI         |
| [0006](adr/0006-procedural-modeling-plus-imports.md)           | Module shapes are written as code, plus imported assets   |
| [0007](adr/0007-export-playable-levels-via-gltf.md)            | Playable levels through glTF and per-engine import scripts |
| [0008](adr/0008-foundations-extend-down.md)                    | Foundations extend down on slopes; terrain is not levelled |
| [0009](adr/0009-map-size-limit.md)                             | Maps are 100 to 1000 meters on each side                  |
| [0010](adr/0010-tech-stack.md)                                 | TypeScript, three.js, manifold-3d, YAML, MIT              |
| [0011](adr/0011-can-float-supports-but-is-listed.md)           | `canFloat` modules can hold others up but are always listed |

### Handoff records

| Record                                              | What it covers                                        |
| --------------------------------------------------- | ----------------------------------------------------- |
| [codex-backend.md](handoff/codex-backend.md)        | Backend implementation brief (for Codex)              |
| [backend-status.md](handoff/backend-status.md)      | Backend status, test results and frontend handoff     |
| [backend-fixes.md](handoff/backend-fixes.md)        | PR #1 review fixes, round 1                           |
| [backend-fixes-2.md](handoff/backend-fixes-2.md)    | PR #1 review fixes, round 2                           |
| [backend-fixes-3.md](handoff/backend-fixes-3.md)    | PR #1 review fixes, round 3                           |
| [backend-fixes-4.md](handoff/backend-fixes-4.md)    | PR #1 review fixes, round 4                           |
| [claude-frontend.md](handoff/claude-frontend.md)    | Frontend implementation brief (for Claude)            |
| [frontend-status.md](handoff/frontend-status.md)    | Frontend status and acceptance records                |
| [frontend-fixes.md](handoff/frontend-fixes.md)      | PR #2 review fixes, round 1                           |
| [frontend-fixes-2.md](handoff/frontend-fixes-2.md)  | PR #2 review fixes, round 2                           |

### Elsewhere in the repository

- [Unity package README](../integrations/unity/README.md): installing the Unity 6 importer and its batchmode test
- [Grey Church](../templates/church/README.md): the example project the Windows launcher adds
- [Agent instructions source](../templates/authoring.md): the text `init` copies into `AGENTS.md` and the Claude Code skill
- [Material sources](../packages/core/materials/SOURCES.md): where each built-in texture comes from
