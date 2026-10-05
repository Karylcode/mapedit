import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function project(invalidSecond = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-multi-map-'));
  temporary.push(root);
  await writeFile(path.join(root, 'project.yaml'), 'name: Multiple maps\n');
  for (const id of ['alpha', 'zeta']) {
    await mkdir(path.join(root, `maps/${id}/structures`), { recursive: true });
    await writeFile(path.join(root, `maps/${id}/map.yaml`), `id: ${id}\nsize: {x: 100, z: 100}\n`);
    await writeFile(
      path.join(root, `maps/${id}/structures/item.yaml`),
      `structures:\n  - id: item\n    position: [${id === 'zeta' && invalidSecond ? 0.1 : 5}, 5]\n    modules: []\n`,
    );
  }
  return root;
}
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
}

it('F3 check without --map catches an off-grid position in the second map', async () => {
  const result = run(await project(), 'check', '--json');
  expect(result.status, result.stderr + result.stdout).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.maps.map((entry: { map: string }) => entry.map)).toEqual(['alpha', 'zeta']);
  expect(report.maps[0]).toMatchObject({ violations: [], fileErrors: [], floating: [] });
  expect(report.maps[1].violations).toContainEqual(expect.objectContaining({ kind: 'off_grid' }));
});
it('F3 --map retains the same maps-array JSON envelope with one map', async () => {
  const result = run(await project(), 'check', '--map', 'alpha', '--json');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    maps: [{ map: 'alpha', violations: [], fileErrors: [], floating: [] }],
  });
  expect(JSON.parse(result.stdout).maps).toHaveLength(1);
});
it('F3 refuses all-map export before writing any output when a later map is invalid', async () => {
  const root = await project();
  const result = run(root, 'export', '--out', 'export');
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain('zeta');
  await expect(readdir(path.join(root, 'export'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('F3 exports every map when all maps pass validation', async () => {
  const root = await project(false);
  const result = run(root, 'export', '--out', 'export');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect((await readdir(path.join(root, 'export'))).sort()).toEqual(['alpha.glb', 'zeta.glb']);
});

it('F3 retains malformed-map diagnostics and preserves existing export files', async () => {
  const root = await project(false);
  await writeFile(path.join(root, 'maps/zeta/map.yaml'), 'size: [unterminated');
  await mkdir(path.join(root, 'export'));
  await writeFile(path.join(root, 'export/alpha.glb'), 'previous successful export');
  const check = run(root, 'check', '--json');
  expect(check.status, check.stderr).toBe(1);
  expect(
    JSON.parse(check.stdout).maps.flatMap((map: { fileErrors: unknown[] }) => map.fileErrors),
  ).toContainEqual(expect.objectContaining({ file: 'maps/zeta/map.yaml' }));
  const result = run(root, 'export', '--out', 'export');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('maps/zeta/map.yaml');
  expect(await readFile(path.join(root, 'export/alpha.glb'), 'utf8')).toBe(
    'previous successful export',
  );
  expect(await readdir(path.join(root, 'export'))).toEqual(['alpha.glb']);
});

it('F3 returns diagnostic map entries when every map is malformed or missing', async () => {
  const root = await project(false);
  await writeFile(path.join(root, 'maps/alpha/map.yaml'), 'size: [unterminated');
  await writeFile(path.join(root, 'maps/zeta/map.yaml'), 'size: [unterminated');
  const result = run(root, 'check', '--json');
  expect(result.status, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.maps.length).toBeGreaterThan(0);
  expect(report.maps[0].fileErrors).toContainEqual(
    expect.objectContaining({ file: 'maps/zeta/map.yaml' }),
  );
});

it('F4 lists floating and grounded canFloat instances while a supported house remains valid', async () => {
  const root = await project(false);
  for (const [id, canFloat] of [
    ['island', true],
    ['house', false],
  ] as const) {
    await mkdir(path.join(root, `modules/${id}`), { recursive: true });
    await writeFile(
      path.join(root, `modules/${id}/module.yaml`),
      `size: [2, 1, 2]\ncanFloat: ${canFloat}\n`,
    );
    await writeFile(
      path.join(root, `modules/${id}/model.ts`),
      "import { box } from '@mapedit/model';\nexport default () => box([2, 1, 2]);\n",
    );
  }
  await writeFile(
    path.join(root, 'maps/alpha/structures/item.yaml'),
    'structures:\n  - id: island\n    position: [10, 10]\n    height: 3\n    modules:\n      - {id: base, module: island, at: [0, 0, 0]}\n      - {id: house, module: house, at: [0, 1, 0]}\n  - id: grounded\n    position: [20, 20]\n    modules: [{id: base, module: island, at: [0, 0, 0]}]\n',
  );
  const result = run(root, 'check', '--json');
  expect(result.status, result.stderr + result.stdout).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.maps[0]).toMatchObject({
    violations: [],
    fileErrors: [],
    floating: [
      { ref: 'module:grounded/base', moduleType: 'island', position: [20, 0, 20] },
      { ref: 'module:island/base', moduleType: 'island', position: [10, 3, 10] },
    ],
  });
  const text = run(root, 'check');
  expect(text.status, text.stderr).toBe(0);
  expect(text.stdout).toContain('module:island/base');
  expect(text.stdout).toContain('module:grounded/base');
  expect(text.stdout).toContain('island at [10, 3, 10]');
});
