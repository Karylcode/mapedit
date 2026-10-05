import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initProject } from '../src/init.js';

const canonical = new URL('../../../templates/authoring.md', import.meta.url);

it('F7 generated templates stay synchronized with their single source', async () => {
  const script = fileURLToPath(new URL('../../../scripts/generate-authoring.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--check'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(
    (
      await readFile(new URL('../../../templates/project/AGENTS.md', import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n'),
  ).toBe((await readFile(canonical, 'utf8')).replaceAll('\r\n', '\n'));
});

it('F7 generated AGENTS and skill are complete, identical authoring guides', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-agent-docs-'));
  try {
    await initProject(root);
    const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    const skill = await readFile(path.join(root, '.claude/skills/mapedit/SKILL.md'), 'utf8');
    for (const document of [agents, skill]) {
      expect(document).toContain('## Workflow');
      expect(document).toContain('## File format');
      expect(document).toContain('## Common errors');
      expect(document).toContain('0.5');
      expect(document).toContain('screenshot');
      expect(document).toContain('canFloat');
      expect(document).toContain('maps');
    }
    expect(skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/, '')).toBe(agents);
    expect(agents.replaceAll('\r\n', '\n')).toBe(
      (await readFile(canonical, 'utf8')).replaceAll('\r\n', '\n'),
    );
    expect(agents).toContain('CLI `check` and `export` process every map');
    expect(agents).toContain('including grounded instances');
    expect(agents).not.toContain('Read `.claude/skills/');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
