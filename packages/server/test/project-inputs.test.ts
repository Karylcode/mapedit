import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProjectInputs, readProjectTexts, projectPath } from '../src/project-files.js';
import { containsPath } from '../src/paths.js';

const roots: string[] = [];
const temporary = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mapedit-inputs-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('F15 shares deterministic authoring reads while reusing unchanged history buffers', async () => {
  const root = await temporary();
  const files = {
    'project.yaml': 'name: Inputs\n',
    'modules/block/module.yaml': 'size: [1,1,1]\n',
    'modules/block/model.ts': 'export default {};',
    'maps/village/map.yaml': 'size: {x: 100, z: 100}\n',
    'maps/village/terrain/height.png': Buffer.from([0, 255, 128, 17]),
    'modules/block/notes.txt': 'not an authoring input',
    'exports/ignored.yaml': 'not an authoring input',
  };
  for (const [file, contents] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), contents);
  }
  const first = await readProjectInputs(root);
  expect([...first.keys()]).toEqual([
    'project.yaml',
    'modules/block/model.ts',
    'modules/block/module.yaml',
    'maps/village/map.yaml',
    'maps/village/terrain/height.png',
  ]);
  expect(first.get('maps/village/terrain/height.png')).toEqual(
    files['maps/village/terrain/height.png'],
  );
  expect(await readProjectTexts(root)).toEqual({
    'project.yaml': files['project.yaml'],
    'modules/block/module.yaml': files['modules/block/module.yaml'],
    'maps/village/map.yaml': files['maps/village/map.yaml'],
  });
  await writeFile(path.join(root, 'modules/block/model.ts'), 'export default {updated:true};');
  const second = await readProjectInputs(root, { previous: first });
  expect(second.get('project.yaml')).toBe(first.get('project.yaml'));
  expect(second.get('maps/village/terrain/height.png')).toBe(
    first.get('maps/village/terrain/height.png'),
  );
  expect(second.get('modules/block/model.ts')).not.toBe(first.get('modules/block/model.ts'));
});

it('F15 never traverses a root input junction to another project', async () => {
  const root = await temporary();
  const outside = await temporary();
  await writeFile(path.join(outside, 'module.yaml'), 'secret');
  await symlink(
    outside,
    path.join(root, 'modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await expect(readProjectInputs(root)).rejects.toThrow(/symbolic link|junction/i);
  await expect(readProjectTexts(root)).rejects.toThrow(/symbolic link|junction/i);
  await expect(projectPath(root, 'modules/module.yaml')).rejects.toThrow(/outside the project/);
});

it('F15 containment accepts descendants but rejects sibling prefix and parent escapes', () => {
  const root = path.resolve('project');
  expect(containsPath(root, root)).toBe(true);
  expect(containsPath(root, path.join(root, 'maps/village/map.yaml'))).toBe(true);
  expect(containsPath(root, `${root}-other/file`)).toBe(false);
  expect(containsPath(root, path.join(root, '../outside'))).toBe(false);
});
