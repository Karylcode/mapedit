import { expect, it } from 'vitest';
import { compileMap } from '../src/compiler.js';
import { parseProject } from '../src/format.js';

const map = { 'maps/test/map.yaml': 'size: {x: 100, z: 100}\n' };

it('defaults the render style to standard', () => {
  const parsed = parseProject({ 'project.yaml': 'name: Plain\n', ...map });
  expect(parsed.project.style).toBe('standard');
});

it('reads style: toon from project.yaml and puts it in every map snapshot', () => {
  const parsed = parseProject({ 'project.yaml': 'name: Cartoon\nstyle: toon\n', ...map });
  expect(parsed.fileErrors).toEqual([]);
  expect(parsed.project.style).toBe('toon');
  expect(compileMap(parsed, 'test').scene.style).toBe('toon');
});

it('rejects an unknown render style on its line', () => {
  const parsed = parseProject({ 'project.yaml': 'name: Odd\nstyle: watercolor\n', ...map });
  expect(parsed.fileErrors).toContainEqual(
    expect.objectContaining({
      file: 'project.yaml',
      line: 2,
      message: expect.stringContaining('standard or toon'),
    }),
  );
});
