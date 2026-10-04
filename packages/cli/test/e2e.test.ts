import { expect, it } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

it('init → author terrain and three houses → check → self-contained GLB through the CLI', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-e2e-'));
  try {
    const script = fileURLToPath(new URL('../../../scripts/e2e.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, root], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60000,
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      violations: 0,
      fileErrors: 0,
      structures: 3,
      modules: 24,
    });
    const config = JSON.parse(await readFile(path.join(root, '.mcp.stdio.json'), 'utf8'));
    expect(config.mcpServers.mapedit.command).toBe(process.execPath);
    expect(config.mcpServers.mapedit.args[0]).not.toContain('{{');
    const again = spawnSync(process.execPath, [config.mcpServers.mapedit.args[0], 'init', root], {
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('overwrite');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
