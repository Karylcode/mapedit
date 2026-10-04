import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('check emits valid JSON and nonzero status for violations and YAML errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-cli-'));
  temporary.push(root);
  await mkdir(path.join(root, 'maps/village/structures'), { recursive: true });
  await writeFile(path.join(root, 'project.yaml'), 'name: CLI test\n');
  await writeFile(
    path.join(root, 'maps/village/map.yaml'),
    'id: village\nname: Village\nsize: {x: 100, z: 100}\n',
  );
  const check = () =>
    spawnSync(process.execPath, [cli, 'check', '--json'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
  const initial = check();
  expect(initial.status, initial.stderr).toBe(0);
  expect(JSON.parse(initial.stdout)).toMatchObject({ violations: [], fileErrors: [] });
  const structures = path.join(root, 'maps/village/structures/house.yaml');
  await writeFile(
    structures,
    'structures:\n  - id: house\n    position: [0.1, 2]\n    modules: [{id: wall, module: missing, at: [0, 0, 0]}]\n',
  );
  const invalid = check();
  expect(invalid.status).toBe(1);
  expect(JSON.parse(invalid.stdout).violations.map((v: { kind: string }) => v.kind)).toContain(
    'missing_reference',
  );
  await writeFile(structures, 'structures: [unterminated');
  const syntax = check();
  expect(syntax.status).toBe(1);
  expect(JSON.parse(syntax.stdout).fileErrors[0]).toMatchObject({
    file: 'maps/village/structures/house.yaml',
    line: 1,
  });
});
