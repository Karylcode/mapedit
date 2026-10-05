import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source =
  (await readFile(new URL('templates/authoring.md', root), 'utf8'))
    .replaceAll('\r\n', '\n')
    .trimEnd() + '\n';
const frontmatter = `---
name: mapedit
description: Build Mapedit structures and modules, change terrain, and fix map violations using project files and MCP.
---

`;
const outputs = new Map([
  ['templates/project/AGENTS.md', source],
  ['templates/project/.claude/skills/mapedit/SKILL.md', frontmatter + source],
]);
const check = process.argv.includes('--check');
for (const [file, expected] of outputs) {
  const url = new URL(file, root);
  let actual;
  try {
    actual = await readFile(url, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (check) {
    if (actual?.replaceAll('\r\n', '\n') !== expected)
      throw new Error(`${file} is stale. Run pnpm generate:authoring.`);
  } else if (actual !== expected) {
    await writeFile(url, expected);
  }
}
