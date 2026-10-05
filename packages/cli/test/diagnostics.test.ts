import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

it('F6 text diagnostics include the source file, line, kind and actionable suggestion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-source-diagnostics-'));
  try {
    await mkdir(path.join(root, 'maps/village/structures'), { recursive: true });
    await writeFile(path.join(root, 'project.yaml'), 'name: Diagnostics\n');
    await writeFile(path.join(root, 'maps/village/map.yaml'), 'size: {x: 100, z: 100}\n');
    await writeFile(
      path.join(root, 'maps/village/structures/house.yaml'),
      'structures:\n  - id: house\n    position: [0.1, 2]\n    modules: []\n',
    );
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.js', import.meta.url)), 'check'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toMatch(/maps\/village\/structures\/house\.yaml:2: off_grid: .+0\.5/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
