# Mapedit project

Build maps by editing the project files. Use MCP to inspect, check, change terrain,
and see the result. All lengths are metres; +Y is up, +X is east, -Z is north.

1. Read the relevant map and structure YAML files. Use `modules` and `free_sockets`
   to discover dimensions and attachment choices.
2. Edit files using stable, descriptive IDs. Give each large structure its own file.
3. Run MCP `check` (or `mapedit check --json`) after each coherent change.
4. Call MCP `screenshot` and inspect the returned image. Correct every violation
   and visual mistake. A successful check alone does not establish visual quality.
5. Export only after `check` reports no violations or file errors.

CLI `check` and `export` process every map unless `--map <id>` is specified. MCP
`check` and `overview` likewise cover all maps unless `map` is specified. CLI
`check --json` always returns `{ "maps": [{ "map": "village", "violations": [],
"fileErrors": [], "floating": [] }] }`, with one entry for a selected map. Any
invalid map makes an all-map export fail before writing output. Review `floating`:
it lists every `canFloat` instance's ref, module type and world position, including
grounded instances. These can support other modules and are informational, not violations.

Read `.claude/skills/mapedit/SKILL.md` when authoring structures, building a module,
changing terrain, or correcting a violation; it contains the format and examples.

Run `mapedit dev` in this directory to enable HTTP MCP and the editor. The bundled
MCP configs use `http://127.0.0.1:4790/mcp`. When HTTP tools are unavailable, use
the alternate `.mcp.stdio.json` or `.codex/config.stdio.toml`. These start the
installed Node executable and CLI directly, avoiding Windows `npx` launch issues.
The stdio bridge attaches to this project's running server or starts one.
If the project or editor installation moves, update the absolute stdio paths.

Screenshots require the editor frontend and Edge or Chrome. When `/render` is not
available, report that visual verification is pending; do not claim to have seen
the map. MCP images are the supported way to inspect screenshots.
